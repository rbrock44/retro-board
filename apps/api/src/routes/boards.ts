import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  BUILT_IN_TEMPLATES, CARD_STATUS_LABELS, CARRIED_OVER_COLUMN, CURRENT_BOARD_TITLE, isCarriedOverColumn, byPosition, positionAfter,
  exportSlug, formatExport, sanitizeTokens, type BoardSettings, type ExportBoard, type ExportFormat, type BoardStateDto, type CardDto, type ColumnSpec,
} from '@retro/shared';
import { toUserDto } from '../auth/users';
import type { Ctx } from '../context';
import {
  actionItems, attachments, boardAccess, boards, cards, columns, replies, teamMembers, teams, templates, users,
} from '../db/schema';
import { attachmentFiles, dropUnusedFiles } from '../lib/file-cleanup';
import { inPrivateBoard, notFromPrivate, requireBoard, requireTeam } from '../lib/access';
import { featureOn, getSettings, newBoardSettings, requireFeature, templateFor } from '../lib/instance';
import { HttpError, badRequest, noContent, notFound, parse, requireUser, zColor, zPosition } from '../lib/http';
import { newId, newToken } from '../lib/ids';
import { guessAllowed, noteWrongGuess } from '../lib/team-lock';
import { boardDto, columnDto, loadActions, loadCards } from '../lib/serialize';
import { teamBoardOverlay, teamPhotoUrl, teamSettings } from './teams';

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
export async function broadcastAction(ctx: Ctx, teamId: string, actionId: string, deleted = false, boardId: string | null = null) {
  const [dto] = deleted ? [] : await loadActions(ctx.db, eq(actionItems.id, actionId));
  // a private board's action items stay on it; the team's show on its other open boards, never on private ones
  const from = boardId ?? dto?.boardId ?? null;
  const [home] = from ? await ctx.db.select({ id: boards.id, private: boards.private }).from(boards).where(eq(boards.id, from)) : [];
  const open = home?.private ? [home]
    : await ctx.db.select({ id: boards.id }).from(boards).where(and(eq(boards.teamId, teamId), eq(boards.status, 'open'), eq(boards.private, false)));
  for (const b of open) {
    ctx.hub.emitBoard(b.id, deleted || !dto ? { type: 'action.delete', id: actionId } : { type: 'action.upsert', action: dto });
  }
}

type Tx = Parameters<Parameters<Ctx['db']['transaction']>[0]>[0];


/**
 * The column a carried card belongs in. A card sitting in "Carried Over" (its column was gone last time) is traced
 * back through the boards it was carried from to the first real column it was in.
 */
async function originColumnTitle(tx: Tx, carriedFromId: string | null, title: string): Promise<string> {
  let from = carriedFromId;
  for (let hops = 0; isCarriedOverColumn(title) && from && hops < 100; hops++) {
    const [prev] = await tx.select({ carriedFromId: cards.carriedFromId, title: columns.title }).from(cards)
      .innerJoin(columns, eq(columns.id, cards.columnId)).where(eq(cards.id, from));
    if (!prev) break;
    ({ title, carriedFromId: from } = prev);
  }
  return title;
}

/**
 * Copies every card in the team marked "carry over" (and not carried yet) onto a new board, linked back to the
 * original, then marks the originals as carried so each moves once. A card lands in the column with the same
 * title as the one it came from; when the new board has no such column, in a "Carried Over" column placed at
 * `carriedPos`.
 */
async function carryPending(tx: Tx, teamId: string, boardId: string, carriedPos: string) {
  // private boards keep their cards to themselves: none carry out of them
  const teamBoards = tx.select({ id: boards.id }).from(boards).where(and(eq(boards.teamId, teamId), sql`${boards.id} <> ${boardId}`, eq(boards.private, false)));
  const pending = await tx.select({ card: cards, columnTitle: columns.title }).from(cards)
    .innerJoin(columns, eq(columns.id, cards.columnId))
    .where(and(inArray(cards.boardId, teamBoards), eq(cards.status, 'carry_over'), isNull(cards.carriedToBoardId)))
    .orderBy(asc(cards.createdAt));
  if (!pending.length) return;

  const targets = new Map((await tx.select().from(columns).where(eq(columns.boardId, boardId))).map(c => [c.title.trim().toLowerCase(), c.id]));
  let carriedColumnId: string | null = null;
  const lastPos = new Map<string, string | null>();
  for (const { card: orig, columnTitle } of pending) {
    const fromTitle = await originColumnTitle(tx, orig.carriedFromId, columnTitle);
    let columnId = !isCarriedOverColumn(fromTitle) ? targets.get(fromTitle.trim().toLowerCase()) : undefined;
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
      carryOver: z.boolean().default(true),
      /** Private (hidden): only its link opens it, plus its creator and team admins */
      private: z.boolean().default(false),
      /** A private board's own password */
      password: z.string().min(4, 'Use at least 4 characters').max(200).optional(),
    }), req.body);
    if (body.password && !body.private) throw badRequest('Only a private board can have its own password');

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

    const carry = await featureOn(ctx, 'carryOver');
    // Anonymous cards, lock and colors belong to the team (team Settings); a new board just follows them.
    const settings = { ...newBoardSettings(site), ...teamBoardOverlay(team.settings) };

    const boardId = newId();
    const privacy = body.private ? { private: true, shareToken: newToken(18), passwordHash: body.password ? await hash(body.password) : null } : {};
    await db.transaction(async tx => {
      await tx.insert(boards).values({ id: boardId, teamId: team.id, title: body.title, settings, createdBy: user.id, ...privacy });
      // The first slot is kept free for a "Carried over" column.
      const carriedColumnPos = positionAfter(null);
      let pos: string = carriedColumnPos;
      for (const spec of specs!) {
        pos = positionAfter(pos);
        await tx.insert(columns).values({ id: newId(), boardId, title: spec.title, color: spec.color, description: spec.description ?? '', position: pos });
      }

      if (body.carryOver && carry && !body.private) await carryPending(tx, team.id, boardId, carriedColumnPos);
    });

    const [b] = await db.select().from(boards).where(eq(boards.id, boardId));
    return boardDto(db, b);
  });

  app.get('/api/boards/:boardId', async (req): Promise<BoardStateDto> => {
    const user = requireUser(req);
    const { board, permissions } = await requireBoard(db, user, (req.params as { boardId: string }).boardId);
    const [cols, shape, actions, memberRows] = await Promise.all([
      db.select().from(columns).where(eq(columns.boardId, board.id)),
      loadCards(db, board.id),
      // a private board shows only its own action items, and the team's other boards never show them
      loadActions(db, board.private ? eq(actionItems.boardId, board.id)
        : and(eq(actionItems.teamId, board.teamId), or(eq(actionItems.status, 'open'), eq(actionItems.boardId, board.id)), notFromPrivate())),
      board.private ? privateBoardPeople(board)
        : db.select({ u: users, role: teamMembers.role }).from(teamMembers).innerJoin(users, eq(users.id, teamMembers.userId)).where(eq(teamMembers.teamId, board.teamId)),
    ]);
    const [team] = await db.select({ id: teams.id, name: teams.name, photoKey: teams.photoKey, settings: teams.settings }).from(teams).where(eq(teams.id, board.teamId));
    return {
      board: await boardDto(db, board),
      team: { id: team.id, name: team.name, photoUrl: teamPhotoUrl(team), pickerSkipsViewers: teamSettings(team.settings).pickerSkipsViewers === true },
      columns: cols.map(columnDto).sort(byPosition),
      cards: shape(user.id).sort(byPosition),
      actions,
      members: memberRows.map(r => toUserDto(r.u)).sort((a, b) => a.name.localeCompare(b.name)),
      viewerIds: memberRows.filter(r => r.role === 'viewer').map(r => r.u.id),
      permissions,
      privateLink: board.private && permissions.canFacilitate ? board.shareToken : null,
    };
  });

  /**
   * The people on a private board, for owners of action items and who presents next: its creator and everyone
   * who came by its link. The rest of the team isn't listed, so the link shows nobody the team's roster.
   */
  async function privateBoardPeople(board: typeof boards.$inferSelect) {
    const ids = (await db.select({ id: boardAccess.userId }).from(boardAccess)
      .where(and(eq(boardAccess.boardId, board.id), eq(boardAccess.linkVersion, board.linkVersion)))).map(r => r.id);
    if (board.createdBy) ids.push(board.createdBy);
    if (!ids.length) return [];
    const rows = await db.select({ u: users, role: teamMembers.role }).from(users)
      .leftJoin(teamMembers, and(eq(teamMembers.userId, users.id), eq(teamMembers.teamId, board.teamId)))
      .where(inArray(users.id, [...new Set(ids)]));
    return rows.map(r => ({ u: r.u, role: r.role ?? 'member' }));
  }

  // ---- private boards: a link that opens it, a new link that cuts off the old one, and its own password ----

  /** Opening a private board's link: this person may come back to it (until the link is replaced) */
  app.post('/api/private/:token', async req => {
    const user = requireUser(req);
    const token = (req.params as { token: string }).token;
    const [board] = token.length >= 16 ? await db.select().from(boards).where(and(eq(boards.shareToken, token), eq(boards.private, true))) : [];
    if (!board) throw notFound('That link');
    await db.insert(boardAccess).values({ boardId: board.id, userId: user.id, linkVersion: board.linkVersion })
      .onConflictDoUpdate({ target: [boardAccess.boardId, boardAccess.userId], set: { linkVersion: board.linkVersion } });
    return { boardId: board.id };
  });

  /** Makes a board private (with a fresh link) or not (its link and password go) */
  app.put('/api/boards/:boardId/private', async req => {
    const user = requireUser(req);
    const { board } = await requireBoard(db, user, (req.params as { boardId: string }).boardId, 'facilitate');
    const body = parse(z.object({ private: z.boolean() }), req.body);
    const [updated] = await db.update(boards).set(body.private
      ? { private: true, shareToken: board.shareToken ?? newToken(18) }
      : { private: false, shareToken: null, linkVersion: board.linkVersion + 1, passwordHash: null, passwordVersion: board.passwordVersion + 1 })
      .where(eq(boards.id, board.id)).returning();
    const dto = await boardDto(db, updated);
    ctx.hub.emitBoard(board.id, { type: 'board.update', board: dto });
    return { board: dto, privateLink: updated.shareToken };
  });

  /** A new link: everyone who came by the old one is out (the creator and team admins stay in) */
  app.post('/api/boards/:boardId/private/new-link', async req => {
    const user = requireUser(req);
    const { board } = await requireBoard(db, user, (req.params as { boardId: string }).boardId, 'facilitate');
    if (!board.private) throw badRequest('Only a private board has a link');
    const [updated] = await db.update(boards).set({ shareToken: newToken(18), linkVersion: board.linkVersion + 1 })
      .where(eq(boards.id, board.id)).returning();
    return { privateLink: updated.shareToken };
  });

  /** Sets or removes (`null`) a private board's password; everyone but its creator types the new one */
  app.put('/api/boards/:boardId/password', async req => {
    const user = requireUser(req);
    const { board } = await requireBoard(db, user, (req.params as { boardId: string }).boardId, 'facilitate');
    if (!board.private) throw badRequest('Only a private board can have its own password');
    const body = parse(z.object({ password: z.string().min(4, 'Use at least 4 characters').max(200).nullable() }), req.body);
    const version = board.passwordVersion + 1;
    const [updated] = await db.update(boards).set({ passwordHash: body.password ? await hash(body.password) : null, passwordVersion: version })
      .where(eq(boards.id, board.id)).returning();
    // whoever set it doesn't have to type it
    if (body.password) {
      await db.insert(boardAccess).values({ boardId: board.id, userId: user.id, passwordVersion: version })
        .onConflictDoUpdate({ target: [boardAccess.boardId, boardAccess.userId], set: { passwordVersion: version } });
    }
    const dto = await boardDto(db, updated);
    ctx.hub.emitBoard(board.id, { type: 'board.update', board: dto });
    return dto;
  });

  /** Typing a private board's password */
  app.post('/api/boards/:boardId/unlock', async req => {
    const user = requireUser(req);
    const [board] = await db.select().from(boards).where(eq(boards.id, (req.params as { boardId: string }).boardId));
    const { password } = parse(z.object({ password: z.string().max(200) }), req.body);
    if (!board?.private || !board.passwordHash) throw notFound('Board');
    const guessKey = `board:${board.id}:${req.ip}`;
    if (!guessAllowed(guessKey)) throw new HttpError(429, 'Too many tries. Wait a minute and try again');
    // only someone in the board (but for the password) may try it
    if (!(await inPrivateBoard(db, user, board))) throw notFound('Board');
    if (!(await verify(board.passwordHash, password))) {
      noteWrongGuess(guessKey);
      throw badRequest("That's not the password");
    }
    await db.insert(boardAccess).values({ boardId: board.id, userId: user.id, passwordVersion: board.passwordVersion })
      .onConflictDoUpdate({ target: [boardAccess.boardId, boardAccess.userId], set: { passwordVersion: board.passwordVersion } });
    return { ok: true };
  });

  app.patch('/api/boards/:boardId', async req => {
    const user = requireUser(req);
    const { board } = await requireBoard(db, user, (req.params as { boardId: string }).boardId, 'facilitate');
    const body = parse(z.object({
      title: z.string().trim().min(1).max(120).optional(),
      status: z.enum(['open', 'archived']).optional(),
    }), req.body);
    const status = body.status ?? board.status;
    const [updated] = await db.update(boards).set({
      title: body.title ?? board.title,
      status,
      closedAt: status === 'open' ? null : board.closedAt ?? new Date(),
    }).where(eq(boards.id, board.id)).returning();
    const dto = await boardDto(db, updated);
    ctx.hub.emitBoard(board.id, { type: 'board.update', board: dto });
    return dto;
  });

  /**
   * "Archive Board": the board as it stands goes into the team's history (closed, titled with the date and an
   * optional name) and a fresh current board takes its place with the same columns and settings. Cards marked
   * "carry over" move to the fresh board, in the column of the same name. Everyone on the old board is sent to
   * the new one.
   */
  app.post('/api/boards/:boardId/archive', async req => {
    const user = requireUser(req);
    const { board } = await requireBoard(db, user, (req.params as { boardId: string }).boardId, 'facilitate');
    if (board.status !== 'open') throw badRequest('This board is already in the history');
    const body = parse(z.object({
      name: z.string().trim().max(80).optional(),
      /** The facilitator's local date, so a retro at 11pm isn't filed under tomorrow */
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }), req.body);
    const savedTitle = savedBoardTitle(body.date ?? new Date().toISOString().slice(0, 10), body.name);

    const carry = await featureOn(ctx, 'carryOver');
    const [teamRow] = await db.select().from(teams).where(eq(teams.id, board.teamId));
    const nextId = newId();
    await db.transaction(async tx => {
      // a private board's link, password and people move to the fresh one, which stays private; the saved one is
      // kept for the people in it
      await tx.update(boards).set({ title: savedTitle, status: 'archived', closedAt: new Date(), ...(board.private ? { shareToken: null } : {}) })
        .where(eq(boards.id, board.id));
      await tx.insert(boards).values({
        id: nextId, teamId: board.teamId, title: board.private ? board.title : CURRENT_BOARD_TITLE, createdBy: board.private ? board.createdBy : user.id,
        settings: { ...newBoardSettings(await getSettings(ctx)), ...teamBoardOverlay(teamRow?.settings) },
        ...(board.private ? {
          private: true, shareToken: board.shareToken, linkVersion: board.linkVersion,
          passwordHash: board.passwordHash, passwordVersion: board.passwordVersion,
        } : {}),
      });
      // everyone in it stays in both: the fresh board, and the saved one in its history
      if (board.private) {
        const people = await tx.select().from(boardAccess).where(eq(boardAccess.boardId, board.id));
        if (people.length) await tx.insert(boardAccess).values(people.map(p => ({ ...p, boardId: nextId })));
      }
      const carriedPos = positionAfter(null);
      let pos = carriedPos;
      const old = (await tx.select().from(columns).where(eq(columns.boardId, board.id))).sort(byPosition);
      for (const c of old.filter(c => !isCarriedOverColumn(c.title))) {
        pos = positionAfter(pos);
        await tx.insert(columns).values({ id: newId(), boardId: nextId, title: c.title, color: c.color, description: c.description, position: pos });
      }
      if (carry && !board.private) await carryPending(tx, board.teamId, nextId, carriedPos);
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
    // a private board is never the team's current one
    const [open] = await db.select({ id: boards.id }).from(boards)
      .where(and(eq(boards.teamId, team.id), eq(boards.status, 'open'), eq(boards.private, false))).orderBy(sql`${boards.createdAt} desc`).limit(1);
    if (open) return { boardId: open.id };
    if (role === 'viewer') return { boardId: null };

    const site = await getSettings(ctx);
    const templateId = templateFor(site, team.settings);
    let specs: ColumnSpec[] = BUILT_IN_TEMPLATES.find(t => t.id === templateId)?.columns ?? [];
    if (!specs.length) {
      const [t] = await db.select().from(templates).where(and(eq(templates.id, templateId), or(eq(templates.teamId, team.id), isNull(templates.teamId))));
      specs = t?.columns ?? BUILT_IN_TEMPLATES[0].columns;
    }
    const carry = await featureOn(ctx, 'carryOver');
    const boardId = newId();
    await db.transaction(async tx => {
      await tx.insert(boards).values({
        id: boardId, teamId: team.id, title: CURRENT_BOARD_TITLE, createdBy: user.id,
        settings: { ...newBoardSettings(site), ...teamBoardOverlay(team.settings) },
      });
      const carriedPos = positionAfter(null);
      let pos = carriedPos;
      for (const spec of specs) {
        pos = positionAfter(pos);
        await tx.insert(columns).values({ id: newId(), boardId, title: spec.title, color: spec.color, description: spec.description ?? '', position: pos });
      }
      if (carry) await carryPending(tx, team.id, boardId, carriedPos);
    });
    return { boardId };
  });

  app.delete('/api/boards/:boardId', async (req, reply) => {
    const user = requireUser(req);
    const { board } = await requireBoard(db, user, (req.params as { boardId: string }).boardId, 'admin');
    const files = await attachmentFiles(ctx, eq(attachments.boardId, board.id));
    await db.delete(boards).where(eq(boards.id, board.id));
    await dropUnusedFiles(ctx, files);
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
    // ?moveTo=<column> keeps the cards (with their groups, likes and replies) by moving them there first
    const { moveTo } = parse(z.object({ moveTo: z.string().max(64).optional() }), req.query);
    if (moveTo) {
      const [target] = await db.select().from(columns).where(eq(columns.id, moveTo));
      if (!target || target.boardId !== col.boardId || target.id === col.id) throw badRequest('Pick another column on this board');
      const moved = await db.transaction(async tx => {
        const here = await tx.select().from(cards).where(eq(cards.columnId, col.id));
        const tops = here.filter(c => !c.parentId).sort(byPosition);
        const last = (await tx.select({ id: cards.id, position: cards.position }).from(cards)
          .where(and(eq(cards.columnId, target.id), isNull(cards.parentId)))).sort(byPosition).at(-1)?.position ?? null;
        // the moved cards go after the target's own, in the order they had
        let pos = last;
        for (const c of tops) {
          pos = positionAfter(pos);
          await tx.update(cards).set({ columnId: target.id, position: pos }).where(eq(cards.id, c.id));
        }
        // cards inside a group keep their place in it
        if (here.some(c => c.parentId)) await tx.update(cards).set({ columnId: target.id }).where(eq(cards.columnId, col.id));
        await tx.delete(columns).where(eq(columns.id, col.id));
        return here.map(c => c.id);
      });
      await broadcastCards(ctx, col.boardId, moved);
      ctx.hub.emitBoard(col.boardId, { type: 'column.delete', id: col.id });
      return noContent(reply);
    }
    const gone = await db.select({ id: cards.id }).from(cards).where(eq(cards.columnId, col.id));
    const goneIds = gone.map(c => c.id);
    const replyIds = goneIds.length ? (await db.select({ id: replies.id }).from(replies).where(inArray(replies.cardId, goneIds))).map(r => r.id) : [];
    const files = goneIds.length ? await attachmentFiles(ctx, replyIds.length
      ? or(inArray(attachments.cardId, goneIds), inArray(attachments.replyId, replyIds)) : inArray(attachments.cardId, goneIds)) : [];
    await db.delete(columns).where(eq(columns.id, col.id));
    await dropUnusedFiles(ctx, files);
    ctx.hub.emitBoard(col.boardId, { type: 'column.delete', id: col.id });
    for (const c of gone) ctx.hub.emitBoard(col.boardId, { type: 'card.delete', id: c.id });
    return noContent(reply);
  });

  // ---- export ----

  /** What an export needs from one board, as this person sees it (anonymous authors stay hidden). */
  async function exportData(board: typeof boards.$inferSelect, userId: string): Promise<ExportBoard> {
    const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, board.teamId));
    return {
      teamName: team?.name ?? '',
      board: { title: board.title, status: board.status, createdAt: board.createdAt.toISOString() },
      columns: (await db.select().from(columns).where(eq(columns.boardId, board.id))).map(columnDto),
      cards: (await loadCards(db, board.id))(userId),
      actions: await loadActions(db, eq(actionItems.boardId, board.id)),
    };
  }

  const sendExport = (reply: FastifyReply, text: string, format: ExportFormat, name: string) =>
    reply.header('content-type', format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8')
      .header('content-disposition', `attachment; filename="${name}.${format}"`)
      .send(format === 'csv' ? text : text + '\n');

  app.get('/api/boards/:boardId/export', async (req, reply) => {
    const user = requireUser(req);
    await requireFeature(ctx, 'export');
    // exports are for team admins (and instance admins), like import (restore) is for instance admins
    const { board } = await requireBoard(db, user, (req.params as { boardId: string }).boardId, 'admin');
    const format: ExportFormat = (req.query as { format?: string }).format === 'csv' ? 'csv' : 'md';
    return sendExport(reply, formatExport([await exportData(board, user.id)], format), format, exportSlug(board.title));
  });

  /** Many boards in one file: Settings > Export, and Export on a team's History. */
  app.post('/api/export', async (req, reply) => {
    const user = requireUser(req);
    await requireFeature(ctx, 'export');
    const body = parse(z.object({
      boardIds: z.array(z.string().min(1).max(64)).min(1, 'pick at least one board').max(500),
      format: z.enum(['md', 'csv']).default('md'),
    }), req.body);
    const picked: ExportBoard[] = [];
    for (const id of [...new Set(body.boardIds)]) {
      const { board } = await requireBoard(db, user, id, 'admin');
      picked.push(await exportData(board, user.id));
    }
    // Grouped by team, oldest board first within a team, so the file reads like a history.
    picked.sort((x, y) => x.teamName.localeCompare(y.teamName) || x.board.createdAt.localeCompare(y.board.createdAt));
    const name = picked.length === 1 ? exportSlug(picked[0].board.title) : `retro-export-${new Date().toISOString().slice(0, 10)}`;
    return sendExport(reply, formatExport(picked, body.format), body.format, name);
  });
}
