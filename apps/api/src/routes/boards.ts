import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  BUILT_IN_TEMPLATES, CARD_STATUS_LABELS, CARRIED_OVER_COLUMN, DEFAULT_BOARD_SETTINGS, byPosition, positionAfter,
  sanitizeTokens, type BoardSettings, type BoardStateDto, type CardDto, type ColumnSpec,
} from '@retro/shared';
import { toUserDto } from '../auth/users';
import type { Ctx } from '../context';
import {
  actionItems, attachments, boards, cards, columns, teamMembers, teams, templates, users, votes,
} from '../db/schema';
import { requireBoard, requireTeam } from '../lib/access';
import { getSettings, newBoardSettings, templateFor } from '../lib/instance';
import { badRequest, noContent, notFound, parse, requireUser, zColor, zPosition } from '../lib/http';
import { newId } from '../lib/ids';
import { boardDto, columnDto, loadActions, loadCards } from '../lib/serialize';

const zSettings = z.object({
  allowAnonymous: z.boolean().optional(),
  votesPerUser: z.number().int().min(0).max(100).optional(),
  maxVotesPerCard: z.number().int().min(1).max(100).optional(),
  locked: z.boolean().optional(),
  theme: z.record(z.string(), z.string()).nullable().optional(),
});

function mergeSettings(base: BoardSettings, patch: z.infer<typeof zSettings>): BoardSettings {
  const next: BoardSettings = { ...base };
  if (patch.allowAnonymous !== undefined) next.allowAnonymous = patch.allowAnonymous;
  if (patch.votesPerUser !== undefined) next.votesPerUser = patch.votesPerUser;
  if (patch.maxVotesPerCard !== undefined) next.maxVotesPerCard = patch.maxVotesPerCard;
  if (patch.locked !== undefined) next.locked = patch.locked;
  if (patch.theme !== undefined) next.theme = patch.theme ? sanitizeTokens(patch.theme) : null;
  return next;
}

/** Emits fresh copies of the given cards to everyone on the board, shaped per viewer. */
export async function broadcastCards(ctx: Ctx, boardId: string, ids: string[]) {
  const shape = await loadCards(ctx.db, boardId, ids);
  const cache = new Map<string, CardDto[]>();
  const forViewer = (v: string) => { if (!cache.has(v)) cache.set(v, shape(v)); return cache.get(v)!; };
  for (let i = 0; i < ids.length; i++) {
    ctx.hub.emitBoard(boardId, viewer => {
      const card = forViewer(viewer)[i];
      return card ? { type: 'card.upsert', card } : null;
    });
  }
}

/** Action items show on every open board of their team, so changes go to all of them. */
export async function broadcastAction(ctx: Ctx, teamId: string, actionId: string, deleted = false) {
  const open = await ctx.db.select({ id: boards.id }).from(boards).where(and(eq(boards.teamId, teamId), eq(boards.status, 'open')));
  const [dto] = deleted ? [] : await loadActions(ctx.db, eq(actionItems.id, actionId));
  for (const b of open) {
    ctx.hub.emitBoard(b.id, deleted || !dto ? { type: 'action.delete', id: actionId } : { type: 'action.upsert', action: dto });
  }
}

type Tx = Parameters<Parameters<Ctx['db']['transaction']>[0]>[0];

/** The title a fresh board gets when a team's current board is saved, or a team is opened with no board */
export const CURRENT_BOARD_TITLE = 'Current retro';

/**
 * Copies every card in the team marked "carry over" (and not carried yet) onto a new board, linked back to the
 * original, then marks the originals as carried so each moves once. With `matchColumns`, a card lands in the
 * column with the same title as the one it came from; otherwise, and for cards with no match, in a
 * "Carried over" column placed at `carriedPos`.
 */
async function carryPending(tx: Tx, teamId: string, boardId: string, carriedPos: string, matchColumns: boolean) {
  const teamBoards = tx.select({ id: boards.id }).from(boards).where(and(eq(boards.teamId, teamId), sql`${boards.id} <> ${boardId}`));
  const pending = await tx.select({ card: cards, columnTitle: columns.title }).from(cards)
    .innerJoin(columns, eq(columns.id, cards.columnId))
    .where(and(inArray(cards.boardId, teamBoards), eq(cards.status, 'carry_over'), isNull(cards.carriedToBoardId)))
    .orderBy(asc(cards.createdAt));
  if (!pending.length) return;

  const targets = matchColumns
    ? new Map((await tx.select().from(columns).where(eq(columns.boardId, boardId))).map(c => [c.title, c.id]))
    : new Map<string, string>();
  let carriedColumnId: string | null = null;
  const lastPos = new Map<string, string | null>();
  for (const { card: orig, columnTitle } of pending) {
    let columnId = columnTitle !== CARRIED_OVER_COLUMN.title ? targets.get(columnTitle) : undefined;
    if (!columnId) {
      if (!carriedColumnId) {
        carriedColumnId = newId();
        await tx.insert(columns).values({ id: carriedColumnId, boardId, ...CARRIED_OVER_COLUMN, description: 'Marked to carry over from earlier retros', position: carriedPos });
      }
      columnId = carriedColumnId;
    }
    const position = positionAfter(lastPos.get(columnId) ?? null);
    lastPos.set(columnId, position);
    const id = newId();
    await tx.insert(cards).values({
      id, boardId, columnId, position, body: orig.body, anonymous: orig.anonymous, authorId: orig.authorId, carriedFromId: orig.id,
    });
    const files = await tx.select().from(attachments).where(eq(attachments.cardId, orig.id));
    for (const f of files) {
      await tx.insert(attachments).values({ ...f, id: newId(), boardId, cardId: id, replyId: null, createdAt: new Date() });
    }
  }
  await tx.update(cards).set({ carriedToBoardId: boardId }).where(inArray(cards.id, pending.map(p => p.card.id)));
}

/** "2026-11-24" or "2026-11-24 · Sprint 42": what a saved board is called in the team's history */
export function savedBoardTitle(date: string, name?: string | null): string {
  const n = name?.trim();
  return n ? `${date} · ${n}` : date;
}

export async function boardRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  app.post('/api/teams/:teamId/boards', async req => {
    const user = requireUser(req);
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId, 'member');
    const body = parse(z.object({
      title: z.string().trim().min(1).max(120),
      templateId: z.string().max(64).optional(),
      columns: z.array(z.object({ title: z.string().trim().min(1).max(80), color: zColor, description: z.string().max(300).optional() })).max(12).optional(),
      settings: zSettings.optional(),
      carryOver: z.boolean().default(true),
    }), req.body);

    let specs: ColumnSpec[] | undefined = body.columns;
    const site = await getSettings(ctx);
    const templateId = body.templateId ?? templateFor(site, team.settings);
    if (!specs?.length) {
      const builtIn = BUILT_IN_TEMPLATES.find(t => t.id === templateId);
      if (builtIn) specs = builtIn.columns;
      else {
        const [t] = await db.select().from(templates).where(and(eq(templates.id, templateId), or(eq(templates.teamId, team.id), isNull(templates.teamId))));
        if (!t) throw badRequest('Unknown template');
        specs = t.columns;
      }
    }

    const settings = mergeSettings(newBoardSettings(site, team.settings), body.settings ?? {});

    const boardId = newId();
    await db.transaction(async tx => {
      await tx.insert(boards).values({ id: boardId, teamId: team.id, title: body.title, settings, createdBy: user.id });
      // The first slot is kept free for a "Carried over" column.
      const carriedColumnPos = positionAfter(null);
      let pos: string = carriedColumnPos;
      for (const spec of specs!) {
        pos = positionAfter(pos);
        await tx.insert(columns).values({ id: newId(), boardId, title: spec.title, color: spec.color, description: spec.description ?? '', position: pos });
      }

      if (body.carryOver) await carryPending(tx, team.id, boardId, carriedColumnPos, false);
    });

    const [b] = await db.select().from(boards).where(eq(boards.id, boardId));
    return boardDto(db, b);
  });

  app.get('/api/boards/:boardId', async (req): Promise<BoardStateDto> => {
    const user = requireUser(req);
    const { board, permissions } = await requireBoard(db, user, (req.params as { boardId: string }).boardId);
    const [cols, shape, actions, memberRows, used] = await Promise.all([
      db.select().from(columns).where(eq(columns.boardId, board.id)),
      loadCards(db, board.id),
      loadActions(db, and(eq(actionItems.teamId, board.teamId), or(eq(actionItems.status, 'open'), eq(actionItems.boardId, board.id)))),
      db.select({ u: users }).from(teamMembers).innerJoin(users, eq(users.id, teamMembers.userId)).where(eq(teamMembers.teamId, board.teamId)),
      db.select({ n: sql<number>`coalesce(sum(${votes.count}), 0)` }).from(votes).where(and(eq(votes.boardId, board.id), eq(votes.userId, user.id))),
    ]);
    const [team] = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.id, board.teamId));
    return {
      board: await boardDto(db, board),
      team,
      columns: cols.map(columnDto).sort(byPosition),
      cards: shape(user.id).sort(byPosition),
      actions,
      members: memberRows.map(r => toUserDto(r.u)).sort((a, b) => a.name.localeCompare(b.name)),
      permissions,
      myVotesUsed: Number(used[0]?.n ?? 0),
    };
  });

  app.patch('/api/boards/:boardId', async req => {
    const user = requireUser(req);
    const { board } = await requireBoard(db, user, (req.params as { boardId: string }).boardId, 'facilitate');
    const body = parse(z.object({
      title: z.string().trim().min(1).max(120).optional(),
      status: z.enum(['open', 'closed', 'archived']).optional(),
      settings: zSettings.optional(),
    }), req.body);
    const status = body.status ?? board.status;
    const [updated] = await db.update(boards).set({
      title: body.title ?? board.title,
      status,
      settings: body.settings ? mergeSettings({ ...DEFAULT_BOARD_SETTINGS, ...board.settings }, body.settings) : board.settings,
      closedAt: status === 'open' ? null : board.closedAt ?? new Date(),
    }).where(eq(boards.id, board.id)).returning();
    const dto = await boardDto(db, updated);
    ctx.hub.emitBoard(board.id, { type: 'board.update', board: dto });
    return dto;
  });

  /**
   * "Save board": the board as it stands goes into the team's history (closed, titled with the date and an
   * optional name) and a fresh current board takes its place with the same columns and settings. Cards marked
   * "carry over" move to the fresh board, in the column of the same name. Everyone on the old board is sent to
   * the new one.
   */
  app.post('/api/boards/:boardId/save', async req => {
    const user = requireUser(req);
    const { board } = await requireBoard(db, user, (req.params as { boardId: string }).boardId, 'facilitate');
    if (board.status !== 'open') throw badRequest('This board is already in the history');
    const body = parse(z.object({
      name: z.string().trim().max(80).optional(),
      /** The facilitator's local date, so a retro at 11pm isn't filed under tomorrow */
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }), req.body);
    const savedTitle = savedBoardTitle(body.date ?? new Date().toISOString().slice(0, 10), body.name);

    const nextId = newId();
    await db.transaction(async tx => {
      await tx.update(boards).set({ title: savedTitle, status: 'closed', closedAt: new Date() }).where(eq(boards.id, board.id));
      await tx.insert(boards).values({
        id: nextId, teamId: board.teamId, title: CURRENT_BOARD_TITLE, createdBy: user.id,
        settings: { ...DEFAULT_BOARD_SETTINGS, ...board.settings, locked: false },
      });
      const carriedPos = positionAfter(null);
      let pos = carriedPos;
      const old = (await tx.select().from(columns).where(eq(columns.boardId, board.id))).sort(byPosition);
      for (const c of old.filter(c => c.title !== CARRIED_OVER_COLUMN.title)) {
        pos = positionAfter(pos);
        await tx.insert(columns).values({ id: newId(), boardId: nextId, title: c.title, color: c.color, description: c.description, position: pos });
      }
      await carryPending(tx, board.teamId, nextId, carriedPos, true);
    });

    const [saved] = await db.select().from(boards).where(eq(boards.id, board.id));
    const [next] = await db.select().from(boards).where(eq(boards.id, nextId));
    ctx.hub.emitBoard(board.id, { type: 'board.update', board: await boardDto(db, saved) });
    ctx.hub.emitBoard(board.id, { type: 'board.next', boardId: nextId, savedTitle });
    return { saved: await boardDto(db, saved), board: await boardDto(db, next) };
  });

  /**
   * Opening a team lands on its current board: the newest open one. A team with none gets one (from its default
   * template) if the person may create boards; otherwise `boardId` is null and the team page shows instead.
   */
  app.post('/api/teams/:teamId/current', async req => {
    const user = requireUser(req);
    const { team, role } = await requireTeam(db, user, (req.params as { teamId: string }).teamId);
    const [open] = await db.select({ id: boards.id }).from(boards)
      .where(and(eq(boards.teamId, team.id), eq(boards.status, 'open'))).orderBy(sql`${boards.createdAt} desc`).limit(1);
    if (open) return { boardId: open.id };
    if (role === 'viewer') return { boardId: null };

    const site = await getSettings(ctx);
    const templateId = templateFor(site, team.settings);
    let specs: ColumnSpec[] = BUILT_IN_TEMPLATES.find(t => t.id === templateId)?.columns ?? [];
    if (!specs.length) {
      const [t] = await db.select().from(templates).where(and(eq(templates.id, templateId), or(eq(templates.teamId, team.id), isNull(templates.teamId))));
      specs = t?.columns ?? BUILT_IN_TEMPLATES[0].columns;
    }
    const boardId = newId();
    await db.transaction(async tx => {
      await tx.insert(boards).values({
        id: boardId, teamId: team.id, title: CURRENT_BOARD_TITLE, createdBy: user.id,
        settings: newBoardSettings(site, team.settings),
      });
      const carriedPos = positionAfter(null);
      let pos = carriedPos;
      for (const spec of specs) {
        pos = positionAfter(pos);
        await tx.insert(columns).values({ id: newId(), boardId, title: spec.title, color: spec.color, description: spec.description ?? '', position: pos });
      }
      await carryPending(tx, team.id, boardId, carriedPos, true);
    });
    return { boardId };
  });

  app.delete('/api/boards/:boardId', async (req, reply) => {
    const user = requireUser(req);
    const { board } = await requireBoard(db, user, (req.params as { boardId: string }).boardId, 'admin');
    await db.delete(boards).where(eq(boards.id, board.id));
    return noContent(reply);
  });

  app.post('/api/boards/:boardId/save-template', async req => {
    const user = requireUser(req);
    const { board } = await requireBoard(db, user, (req.params as { boardId: string }).boardId);
    await requireTeam(db, user, board.teamId, 'admin');
    const { name, description } = parse(z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(300).default('') }), req.body);
    const cols = (await db.select().from(columns).where(eq(columns.boardId, board.id))).sort(byPosition);
    const [t] = await db.insert(templates).values({
      id: newId(), teamId: board.teamId, name, description,
      columns: cols.map(c => ({ title: c.title, color: c.color, description: c.description || undefined })),
    }).returning();
    return { id: t.id, name: t.name, description: t.description, columns: t.columns, builtIn: false };
  });

  // ---- columns (board facilitators) ----

  app.post('/api/boards/:boardId/columns', async req => {
    const user = requireUser(req);
    const { board } = await requireBoard(db, user, (req.params as { boardId: string }).boardId, 'facilitate');
    const body = parse(z.object({ title: z.string().trim().min(1).max(80), color: zColor, description: z.string().max(300).default('') }), req.body);
    const existing = (await db.select().from(columns).where(eq(columns.boardId, board.id))).sort(byPosition);
    if (existing.length >= 12) throw badRequest('A board can have at most 12 columns');
    const [col] = await db.insert(columns).values({
      id: newId(), boardId: board.id, ...body, position: positionAfter(existing.at(-1)?.position ?? null),
    }).returning();
    const dto = columnDto(col);
    ctx.hub.emitBoard(board.id, { type: 'column.upsert', column: dto });
    return dto;
  });

  app.patch('/api/columns/:columnId', async req => {
    const user = requireUser(req);
    const [col] = await db.select().from(columns).where(eq(columns.id, (req.params as { columnId: string }).columnId));
    if (!col) throw notFound('Column');
    await requireBoard(db, user, col.boardId, 'facilitate');
    const body = parse(z.object({
      title: z.string().trim().min(1).max(80).optional(),
      color: zColor.optional(),
      description: z.string().max(300).optional(),
      position: zPosition.optional(),
    }), req.body);
    const [updated] = await db.update(columns).set({
      title: body.title ?? col.title, color: body.color ?? col.color,
      description: body.description ?? col.description, position: body.position ?? col.position,
    }).where(eq(columns.id, col.id)).returning();
    const dto = columnDto(updated);
    ctx.hub.emitBoard(col.boardId, { type: 'column.upsert', column: dto });
    return dto;
  });

  app.delete('/api/columns/:columnId', async (req, reply) => {
    const user = requireUser(req);
    const [col] = await db.select().from(columns).where(eq(columns.id, (req.params as { columnId: string }).columnId));
    if (!col) throw notFound('Column');
    await requireBoard(db, user, col.boardId, 'facilitate');
    const gone = await db.select({ id: cards.id }).from(cards).where(eq(cards.columnId, col.id));
    await db.delete(columns).where(eq(columns.id, col.id));
    ctx.hub.emitBoard(col.boardId, { type: 'column.delete', id: col.id });
    for (const c of gone) ctx.hub.emitBoard(col.boardId, { type: 'card.delete', id: c.id });
    return noContent(reply);
  });

  // ---- export ----

  app.get('/api/boards/:boardId/export', async (req, reply) => {
    const user = requireUser(req);
    const { board } = await requireBoard(db, user, (req.params as { boardId: string }).boardId);
    const format = (req.query as { format?: string }).format === 'csv' ? 'csv' : 'md';
    const cols = (await db.select().from(columns).where(eq(columns.boardId, board.id))).sort(byPosition);
    const all = (await loadCards(db, board.id))(user.id).sort(byPosition);
    const actions = await loadActions(db, eq(actionItems.boardId, board.id));
    const slug = board.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';
    const who = (c: CardDto) => (c.anonymous ? 'Anonymous' : c.author?.name ?? 'Someone');

    if (format === 'csv') {
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['column', 'group', 'card', 'author', 'votes', 'status', 'replies', 'created'].join(',')];
      for (const col of cols) {
        for (const c of all.filter(x => x.columnId === col.id)) {
          const head = c.parentId ? all.find(x => x.id === c.parentId) : null;
          lines.push([col.title, head ? head.groupTitle ?? head.body.slice(0, 40) : c.groupTitle ?? '', c.body, who(c), c.votes,
            CARD_STATUS_LABELS[c.status], c.replies.length, c.createdAt].map(esc).join(','));
        }
      }
      lines.push('', ['action', 'owner', 'due', 'status'].join(','));
      for (const a of actions) lines.push([a.title, a.owner?.name ?? '', a.dueDate ?? '', a.status].map(esc).join(','));
      return reply.header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${slug}.csv"`).send(lines.join('\n'));
    }

    const md: string[] = [`# ${board.title}`, '', `_${new Date(board.createdAt).toDateString()} · ${board.status}_`, ''];
    for (const col of cols) {
      md.push(`## ${col.title}`, '');
      const heads = all.filter(c => c.columnId === col.id && !c.parentId).sort((a, b) => b.votes - a.votes);
      if (!heads.length) md.push('_No cards_', '');
      for (const h of heads) {
        const kids = all.filter(c => c.parentId === h.id);
        const total = h.votes + kids.reduce((n, k) => n + k.votes, 0);
        const tag = h.status !== 'none' ? ` \`${CARD_STATUS_LABELS[h.status]}\`` : '';
        if (kids.length) {
          md.push(`- **${h.groupTitle ?? 'Group'}** (${total} votes)${tag}`);
          for (const c of [h, ...kids]) md.push(`  - ${c.body.replace(/\n+/g, ' ')} — ${who(c)} (${c.votes})`);
        } else {
          md.push(`- ${h.body.replace(/\n+/g, ' ')} — ${who(h)} (${h.votes} votes)${tag}`);
        }
        for (const r of [h, ...kids].flatMap(c => c.replies)) md.push(`  - ↳ ${r.author?.name ?? 'Someone'}: ${r.body.replace(/\n+/g, ' ')}`);
      }
      md.push('');
    }
    md.push('## Action items', '');
    if (!actions.length) md.push('_None_');
    for (const a of actions) {
      md.push(`- [${a.status === 'done' ? 'x' : ' '}] ${a.title}${a.owner ? ` — @${a.owner.name}` : ''}${a.dueDate ? ` (due ${a.dueDate})` : ''}`);
    }
    return reply.header('content-type', 'text/markdown; charset=utf-8')
      .header('content-disposition', `attachment; filename="${slug}.md"`).send(md.join('\n') + '\n');
  });
}
