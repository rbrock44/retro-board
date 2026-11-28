import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';
import { actionItems, boardAccess, boards, cards, teamMembers, type User } from '../db/schema';
import { requireBoard, requireTeam } from '../lib/access';
import { badRequest, noContent, notFound, parse, requireUser, zId } from '../lib/http';
import { requireFeature } from '../lib/instance';
import { newId } from '../lib/ids';
import { loadActions } from '../lib/serialize';
import { broadcastAction } from './boards';

const zDue = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').nullable();

export async function actionRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  async function checkOwner(teamId: string, ownerId: string | null | undefined, privateBoard: typeof boards.$inferSelect | null = null) {
    if (!ownerId) return;
    // on a private board, anyone on it can own one: its creator, or someone who came by its link
    if (privateBoard) {
      if (privateBoard.createdBy === ownerId) return;
      const [a] = await db.select().from(boardAccess).where(and(eq(boardAccess.boardId, privateBoard.id), eq(boardAccess.userId, ownerId)));
      if (a?.linkVersion === privateBoard.linkVersion) return;
    }
    const [m] = await db.select().from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, ownerId)));
    if (!m) throw badRequest('The owner must be on the team');
  }

  /**
   * May this person change action items here? A private board's are for the people on it (some may not be on the
   * team); the team's are for its members.
   */
  async function requireActions(user: User, teamId: string, boardId: string | null) {
    const [b] = boardId ? await db.select().from(boards).where(eq(boards.id, boardId)) : [];
    if (b?.private) {
      await requireBoard(db, user, b.id, 'vote');
      return b;
    }
    await requireTeam(db, user, teamId, 'member');
    return null;
  }

  app.post('/api/teams/:teamId/actions', async req => {
    const user = requireUser(req);
    await requireFeature(ctx, 'actions');
    const teamId = (req.params as { teamId: string }).teamId;
    const body = parse(z.object({
      title: z.string().trim().min(1).max(300),
      ownerId: zId.nullable().optional(),
      dueDate: zDue.optional(),
      boardId: zId.nullable().optional(),
      cardId: zId.nullable().optional(),
    }), req.body);
    let boardId = body.boardId ?? null;
    if (body.cardId) {
      const [c] = await db.select().from(cards).where(eq(cards.id, body.cardId));
      if (!c) throw notFound('Card');
      boardId = c.boardId;
    }
    if (boardId) {
      const [b] = await db.select().from(boards).where(eq(boards.id, boardId));
      if (!b || b.teamId !== teamId) throw badRequest('That board belongs to another team');
    }
    const privateBoard = await requireActions(user, teamId, boardId);
    await checkOwner(teamId, body.ownerId, privateBoard);
    const team = { id: teamId };
    const id = newId();
    await db.insert(actionItems).values({
      id, teamId: team.id, boardId, cardId: body.cardId ?? null, title: body.title,
      ownerId: body.ownerId ?? null, dueDate: body.dueDate ?? null, createdBy: user.id,
    });
    await broadcastAction(ctx, team.id, id);
    return (await loadActions(db, eq(actionItems.id, id)))[0];
  });

  app.patch('/api/actions/:actionId', async req => {
    const user = requireUser(req);
    const [a] = await db.select().from(actionItems).where(eq(actionItems.id, (req.params as { actionId: string }).actionId));
    if (!a) throw notFound('Action item');
    const privateBoard = await requireActions(user, a.teamId, a.boardId);
    const body = parse(z.object({
      title: z.string().trim().min(1).max(300).optional(),
      ownerId: zId.nullable().optional(),
      dueDate: zDue.optional(),
      status: z.enum(['open', 'done']).optional(),
    }), req.body);
    await checkOwner(a.teamId, body.ownerId, privateBoard);
    const status = body.status ?? a.status;
    await db.update(actionItems).set({
      title: body.title ?? a.title,
      ownerId: body.ownerId !== undefined ? body.ownerId : a.ownerId,
      dueDate: body.dueDate !== undefined ? body.dueDate : a.dueDate,
      status,
      completedAt: status === 'done' ? a.completedAt ?? new Date() : null,
    }).where(eq(actionItems.id, a.id));
    await broadcastAction(ctx, a.teamId, a.id);
    return (await loadActions(db, eq(actionItems.id, a.id)))[0];
  });

  app.delete('/api/actions/:actionId', async (req, reply) => {
    const user = requireUser(req);
    const [a] = await db.select().from(actionItems).where(eq(actionItems.id, (req.params as { actionId: string }).actionId));
    if (!a) throw notFound('Action item');
    await requireActions(user, a.teamId, a.boardId);
    await db.delete(actionItems).where(eq(actionItems.id, a.id));
    await broadcastAction(ctx, a.teamId, a.id, true, a.boardId);
    return noContent(reply);
  });
}
