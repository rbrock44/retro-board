import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CARD_STATUSES, byPosition, isEmoji, positionAfter, type CardStatus } from '@retro/shared';
import type { Ctx } from '../context';
import type { Db } from '../db';
import { attachments, cards, columns, reactions, replies, votes, type User } from '../db/schema';
import { canEditOwn, loadCard, loadReply, requireBoard } from '../lib/access';
import { badRequest, forbidden, noContent, notFound, parse, requireNamed, requireUser, zBody, zId, zPosition } from '../lib/http';
import { requireFeature } from '../lib/instance';
import { attachmentFiles, dropUnusedFiles } from '../lib/file-cleanup';
import { newId } from '../lib/ids';
import { loadCards } from '../lib/serialize';
import { broadcastCards } from './boards';

const zAttachmentIds = z.array(zId).max(10).default([]);

/** Attaches freshly uploaded, not-yet-used files from this board and this uploader. */
async function claimAttachments(db: Db, user: User, boardId: string, ids: string[], target: { cardId?: string; replyId?: string }) {
  if (!ids.length) return;
  const rows = await db.select().from(attachments).where(and(
    inArray(attachments.id, ids), eq(attachments.boardId, boardId), eq(attachments.uploaderId, user.id),
    isNull(attachments.cardId), isNull(attachments.replyId),
  ));
  if (rows.length !== new Set(ids).size) throw badRequest('Some attachments are missing or already used');
  await db.update(attachments).set(target).where(inArray(attachments.id, ids));
}

export async function cardRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  const emit = (boardId: string, ids: string[]) => broadcastCards(ctx, boardId, ids);

  async function lastPosition(columnId: string): Promise<string | null> {
    const rows = await db.select({ id: cards.id, position: cards.position }).from(cards).where(eq(cards.columnId, columnId));
    return rows.sort(byPosition).at(-1)?.position ?? null;
  }

  app.post('/api/boards/:boardId/cards', async req => {
    const user = requireNamed(req);
    const { board } = await requireBoard(db, user, (req.params as { boardId: string }).boardId, 'write');
    const body = parse(z.object({
      columnId: zId,
      body: zBody,
      anonymous: z.boolean().default(false),
      attachmentIds: zAttachmentIds,
    }), req.body);
    if (!body.body.trim() && !body.attachmentIds.length) throw badRequest('A card needs text or an attachment');
    if (body.anonymous) await requireFeature(ctx, 'anonymous');
    if (body.anonymous && !board.settings.allowAnonymous) throw forbidden('Anonymous cards are turned off on this board');
    const [col] = await db.select().from(columns).where(and(eq(columns.id, body.columnId), eq(columns.boardId, board.id)));
    if (!col) throw notFound('Column');
    const id = newId();
    await db.insert(cards).values({
      id, boardId: board.id, columnId: col.id, position: positionAfter(await lastPosition(col.id)),
      body: body.body.trim(), anonymous: body.anonymous, authorId: user.id,
    });
    await claimAttachments(db, user, board.id, body.attachmentIds, { cardId: id });
    await emit(board.id, [id]);
    return (await loadCards(db, board.id, [id]))(user.id)[0];
  });

  app.patch('/api/cards/:cardId', async req => {
    const user = requireUser(req);
    const card = await loadCard(db, (req.params as { cardId: string }).cardId);
    const body = parse(z.object({
      body: zBody.optional(),
      anonymous: z.boolean().optional(),
      status: z.enum(CARD_STATUSES as [CardStatus, ...CardStatus[]]).optional(),
      groupTitle: z.string().trim().max(120).nullable().optional(),
      attachmentIds: zAttachmentIds.optional(),
      removeAttachmentIds: z.array(zId).max(20).optional(),
    }), req.body);

    // Marking and naming groups is facilitation-ish but every member may do it; text edits are author-only.
    const editsContent = body.body !== undefined || body.anonymous !== undefined || body.attachmentIds?.length || body.removeAttachmentIds?.length;
    const bctx = await requireBoard(db, user, card.boardId, editsContent ? 'write' : 'vote');
    if (editsContent && !canEditOwn(bctx, card.authorId, user.id)) throw forbidden('Only the author can edit this card');
    // Once anonymous, always: showing the name later would give away who wrote it
    if (card.anonymous && body.anonymous === false) throw badRequest('An anonymous card stays anonymous');
    if (body.anonymous && !card.anonymous) await requireFeature(ctx, 'anonymous');
    if (body.status === 'carry_over') await requireFeature(ctx, 'carryOver');
    if (body.groupTitle !== undefined) await requireFeature(ctx, 'groups');
    if (body.anonymous && !bctx.board.settings.allowAnonymous) throw forbidden('Anonymous cards are turned off on this board');

    await db.update(cards).set({
      body: body.body !== undefined ? body.body.trim() : card.body,
      anonymous: body.anonymous ?? card.anonymous,
      status: body.status ?? card.status,
      groupTitle: body.groupTitle !== undefined ? body.groupTitle || null : card.groupTitle,
      editedAt: body.body !== undefined ? new Date() : card.editedAt,
    }).where(eq(cards.id, card.id));
    if (body.attachmentIds?.length) await claimAttachments(db, user, card.boardId, body.attachmentIds, { cardId: card.id });
    if (body.removeAttachmentIds?.length) {
      const which = and(eq(attachments.cardId, card.id), inArray(attachments.id, body.removeAttachmentIds));
      const files = await attachmentFiles(ctx, which);
      await db.delete(attachments).where(which);
      await dropUnusedFiles(ctx, files);
    }
    await emit(card.boardId, [card.id]);
    return { ok: true };
  });

  app.post('/api/cards/:cardId/move', async req => {
    const user = requireUser(req);
    const card = await loadCard(db, (req.params as { cardId: string }).cardId);
    await requireBoard(db, user, card.boardId, 'write');
    const body = parse(z.object({ columnId: zId, position: zPosition, alone: z.boolean().optional() }), req.body);
    const [col] = await db.select().from(columns).where(and(eq(columns.id, body.columnId), eq(columns.boardId, card.boardId)));
    if (!col) throw notFound('Column');
    // Moving a grouped card on its own pulls it out of the group; moving a group head brings its group along,
    // unless `alone`: then just that card leaves and the rest of the group stays where it was.
    const left = body.alone ? await detachAlone(card) : [];
    await db.update(cards).set({ columnId: col.id, position: body.position, parentId: null }).where(eq(cards.id, card.id));
    const kids = await db.update(cards).set({ columnId: col.id }).where(eq(cards.parentId, card.id)).returning({ id: cards.id });
    await emit(card.boardId, [card.id, ...kids.map(k => k.id), ...left]);
    return { ok: true };
  });

  app.post('/api/cards/:cardId/group', async req => {
    const user = requireUser(req);
    await requireFeature(ctx, 'groups');
    const card = await loadCard(db, (req.params as { cardId: string }).cardId);
    await requireBoard(db, user, card.boardId, 'write');
    const { targetId } = parse(z.object({ targetId: zId }), req.body);
    const target = await loadCard(db, targetId);
    if (target.boardId !== card.boardId) throw badRequest('Cards are on different boards');
    const headId = target.parentId ?? target.id;
    if (headId === card.id) return { ok: true };
    const head = headId === target.id ? target : await loadCard(db, headId);
    const moved = await db.update(cards).set({ parentId: head.id, columnId: head.columnId })
      .where(or(eq(cards.id, card.id), eq(cards.parentId, card.id))).returning({ id: cards.id });
    await emit(card.boardId, [head.id, ...moved.map(m => m.id)]);
    return { ok: true };
  });

  /**
   * Puts a group's cards in this order; the first one leads the group (takes its place and its name). A card from
   * another group, or a loose one, can be listed too: it leaves where it was and joins.
   */
  app.post('/api/cards/:cardId/arrange', async req => {
    const user = requireUser(req);
    await requireFeature(ctx, 'groups');
    const card = await loadCard(db, (req.params as { cardId: string }).cardId);
    await requireBoard(db, user, card.boardId, 'write');
    const { order } = parse(z.object({ order: z.array(zId).min(1).max(500) }), req.body);
    if (new Set(order).size !== order.length) throw badRequest('A card is listed twice');
    const headId = card.parentId ?? card.id;
    const members = await db.select().from(cards).where(or(eq(cards.id, headId), eq(cards.parentId, headId)));
    if (!members.every(m => order.includes(m.id))) throw badRequest('List every card in the group');
    const touched = new Set<string>(order);
    for (const id of order) {
      if (members.some(m => m.id === id)) continue;
      const joining = await loadCard(db, id);
      if (joining.boardId !== card.boardId) throw badRequest('Cards are on different boards');
      for (const t of await detachAlone(joining)) touched.add(t);
    }
    const oldHead = members.find(m => m.id === headId)!;
    const [lead, ...rest] = order;
    await db.update(cards).set({ parentId: null, columnId: oldHead.columnId, position: oldHead.position, groupTitle: oldHead.groupTitle })
      .where(eq(cards.id, lead));
    let pos: string | null = null;
    for (const id of rest) {
      pos = positionAfter(pos);
      await db.update(cards).set({ parentId: lead, columnId: oldHead.columnId, position: pos, ...(id === headId ? { groupTitle: null } : {}) })
        .where(eq(cards.id, id));
    }
    await emit(card.boardId, [...touched]);
    return { ok: true };
  });

  /** Takes one card out of its group, leaving the others grouped. Returns the ids of the other cards it changed. */
  async function detachAlone(card: typeof cards.$inferSelect): Promise<string[]> {
    if (card.parentId) {
      await db.update(cards).set({ parentId: null }).where(eq(cards.id, card.id));
      return [card.parentId];
    }
    const kids = (await db.select().from(cards).where(eq(cards.parentId, card.id))).sort(byPosition);
    if (!kids.length) return [];
    const [lead, ...rest] = kids;
    await db.update(cards).set({ parentId: null, columnId: card.columnId, position: card.position, groupTitle: card.groupTitle })
      .where(eq(cards.id, lead.id));
    if (rest.length) await db.update(cards).set({ parentId: lead.id }).where(inArray(cards.id, rest.map(r => r.id)));
    await db.update(cards).set({ groupTitle: null }).where(eq(cards.id, card.id));
    return kids.map(k => k.id);
  }

  app.post('/api/cards/:cardId/ungroup', async req => {
    const user = requireUser(req);
    const card = await loadCard(db, (req.params as { cardId: string }).cardId);
    await requireBoard(db, user, card.boardId, 'write');
    if (card.parentId) {
      await db.update(cards).set({ parentId: null, position: positionAfter(await lastPosition(card.columnId)) }).where(eq(cards.id, card.id));
      await emit(card.boardId, [card.id, card.parentId]);
    } else {
      // Ungrouping a head breaks the whole group apart.
      const kids = await db.update(cards).set({ parentId: null }).where(eq(cards.parentId, card.id)).returning({ id: cards.id });
      await db.update(cards).set({ groupTitle: null }).where(eq(cards.id, card.id));
      await emit(card.boardId, [card.id, ...kids.map(k => k.id)]);
    }
    return { ok: true };
  });

  app.delete('/api/cards/:cardId', async (req, reply) => {
    const user = requireUser(req);
    const card = await loadCard(db, (req.params as { cardId: string }).cardId);
    const bctx = await requireBoard(db, user, card.boardId, 'write');
    if (!canEditOwn(bctx, card.authorId, user.id)) throw forbidden('Only the author can delete this card');
    const kids = await db.update(cards).set({ parentId: null }).where(eq(cards.parentId, card.id)).returning({ id: cards.id });
    const replyIds = (await db.select({ id: replies.id }).from(replies).where(eq(replies.cardId, card.id))).map(r => r.id);
    await db.delete(reactions).where(inArray(reactions.targetId, [card.id, ...replyIds]));
    // its files (and its replies'), removed once the rows are gone
    const files = await attachmentFiles(ctx, replyIds.length
      ? or(eq(attachments.cardId, card.id), inArray(attachments.replyId, replyIds)) : eq(attachments.cardId, card.id));
    await db.delete(cards).where(eq(cards.id, card.id));
    await dropUnusedFiles(ctx, files);
    ctx.hub.emitBoard(card.boardId, { type: 'card.delete', id: card.id });
    if (kids.length) await emit(card.boardId, kids.map(k => k.id));
    return noContent(reply);
  });

  // ---- likes: one per person per card (stored in `votes` with count 1) ----

  app.post('/api/cards/:cardId/vote', async req => {
    const user = requireUser(req);
    await requireFeature(ctx, 'likes');
    const card = await loadCard(db, (req.params as { cardId: string }).cardId);
    const { board } = await requireBoard(db, user, card.boardId, 'vote');
    await db.insert(votes).values({ boardId: board.id, cardId: card.id, userId: user.id, count: 1 }).onConflictDoNothing();
    await emit(board.id, [card.id]);
    return { ok: true };
  });

  app.delete('/api/cards/:cardId/vote', async req => {
    const user = requireUser(req);
    const card = await loadCard(db, (req.params as { cardId: string }).cardId);
    const { board } = await requireBoard(db, user, card.boardId, 'vote');
    await db.delete(votes).where(and(eq(votes.cardId, card.id), eq(votes.userId, user.id)));
    await emit(board.id, [card.id]);
    return { ok: true };
  });

  // ---- reactions (toggle) ----

  app.post('/api/reactions', async req => {
    const user = requireUser(req);
    await requireFeature(ctx, 'reactions');
    const body = parse(z.object({
      targetType: z.enum(['card', 'reply']),
      targetId: zId,
      // any one emoji (the picker offers them all), but only an emoji
      emoji: z.string().min(1).max(32).refine(isEmoji, 'Pick an emoji'),
    }), req.body);
    const cardId = body.targetType === 'card' ? body.targetId : (await loadReply(db, body.targetId)).cardId;
    const card = await loadCard(db, cardId);
    await requireBoard(db, user, card.boardId, 'vote');
    const match = and(eq(reactions.targetType, body.targetType), eq(reactions.targetId, body.targetId),
      eq(reactions.userId, user.id), eq(reactions.emoji, body.emoji));
    const [existing] = await db.select().from(reactions).where(match);
    if (existing) await db.delete(reactions).where(eq(reactions.id, existing.id));
    else await db.insert(reactions).values({ id: newId(), boardId: card.boardId, ...body, userId: user.id });
    await emit(card.boardId, [card.id]);
    return { active: !existing };
  });

  // ---- replies ----

  app.post('/api/cards/:cardId/replies', async req => {
    const user = requireNamed(req);
    await requireFeature(ctx, 'replies');
    const card = await loadCard(db, (req.params as { cardId: string }).cardId);
    await requireBoard(db, user, card.boardId, 'write');
    const body = parse(z.object({ body: zBody, parentId: zId.nullable().optional(), attachmentIds: zAttachmentIds }), req.body);
    if (!body.body.trim() && !body.attachmentIds.length) throw badRequest('A reply needs text or an attachment');
    let parentId: string | null = null;
    if (body.parentId) {
      const parent = await loadReply(db, body.parentId);
      if (parent.cardId !== card.id) throw badRequest('That reply is on a different card');
      parentId = parent.parentId ?? parent.id; // one level of nesting
    }
    const id = newId();
    await db.insert(replies).values({ id, boardId: card.boardId, cardId: card.id, parentId, authorId: user.id, body: body.body.trim() });
    await claimAttachments(db, user, card.boardId, body.attachmentIds, { replyId: id });
    await emit(card.boardId, [card.id]);
    return { id };
  });

  app.patch('/api/replies/:replyId', async req => {
    const user = requireUser(req);
    const r = await loadReply(db, (req.params as { replyId: string }).replyId);
    const bctx = await requireBoard(db, user, r.boardId, 'write');
    if (!canEditOwn(bctx, r.authorId, user.id)) throw forbidden('Only the author can edit this reply');
    const body = parse(z.object({ body: zBody }), req.body);
    await db.update(replies).set({ body: body.body.trim(), editedAt: new Date() }).where(eq(replies.id, r.id));
    await emit(r.boardId, [r.cardId]);
    return { ok: true };
  });

  app.delete('/api/replies/:replyId', async (req, reply) => {
    const user = requireUser(req);
    const r = await loadReply(db, (req.params as { replyId: string }).replyId);
    const bctx = await requireBoard(db, user, r.boardId, 'write');
    if (!canEditOwn(bctx, r.authorId, user.id)) throw forbidden('Only the author can delete this reply');
    const childIds = (await db.select({ id: replies.id }).from(replies).where(eq(replies.parentId, r.id))).map(x => x.id);
    await db.delete(reactions).where(inArray(reactions.targetId, [r.id, ...childIds]));
    const files = await attachmentFiles(ctx, inArray(attachments.replyId, [r.id, ...childIds]));
    await db.delete(replies).where(or(eq(replies.id, r.id), eq(replies.parentId, r.id)));
    await dropUnusedFiles(ctx, files);
    await emit(r.boardId, [r.cardId]);
    return noContent(reply);
  });
}
