import { and, count, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  BUILT_IN_TEMPLATES, TEAM_BOARD_SETTING_KEYS, TEAM_ROLES, sanitizeTokens, type BoardSettings, type InviteDto,
  type SearchResultDto, type TeamDto, type TeamMemberDto, type TeamSettings, type TemplateDto,
} from '@retro/shared';
import { findUserByEmail, toUserDto } from '../auth/users';
import type { Ctx } from '../context';
import {
  actionItems, boards, cards, invites, teamMembers, teams, templates, users, type Team, type User,
} from '../db/schema';
import { requireTeam, teamRole } from '../lib/access';
import { badRequest, noContent, notFound, parse, requireAdmin, requireUser, zColor } from '../lib/http';
import { newId, newToken } from '../lib/ids';
import { acceptInvite, findValidInvite } from '../lib/invites';
import { boardDto, boardDtos, loadActions } from '../lib/serialize';

const zRole = z.enum(TEAM_ROLES as [string, ...string[]]).transform(r => r as (typeof TEAM_ROLES)[number]);
const zTeamSettings = z.object({
  defaultTemplateId: z.string().max(64).optional(),
  allowAnonymous: z.boolean().optional(),
  locked: z.boolean().optional(),
  theme: z.record(z.string(), z.string()).nullable().optional(),
});

/** Only the settings teams still have; older rows may carry keys that are gone (like vote limits). */
export function teamSettings(stored: (TeamSettings & { anonymousByDefault?: boolean }) | null | undefined): TeamSettings {
  const out: TeamSettings = {};
  if (stored?.defaultTemplateId !== undefined) out.defaultTemplateId = stored.defaultTemplateId;
  const anon = stored?.allowAnonymous ?? stored?.anonymousByDefault; // older name
  if (anon !== undefined) out.allowAnonymous = anon;
  if (stored?.locked !== undefined) out.locked = stored.locked;
  if (stored?.theme !== undefined) out.theme = stored.theme ? sanitizeTokens(stored.theme) : null;
  return out;
}

/**
 * Puts the team's board settings on its open (current) boards, and tells anyone looking at one. Boards in the
 * history keep the settings they had when they were archived, so opening one shows it exactly as it was.
 */
async function applyToBoards(ctx: Ctx, team: Team) {
  const overlay = teamBoardOverlay(team.settings);
  const rows = await ctx.db.select().from(boards).where(and(eq(boards.teamId, team.id), eq(boards.status, 'open')));
  for (const b of rows) {
    const [next] = await ctx.db.update(boards).set({ settings: { ...b.settings, ...overlay } }).where(eq(boards.id, b.id)).returning();
    if (next.status === 'open') ctx.hub.emitBoard(next.id, { type: 'board.update', board: await boardDto(ctx.db, next) });
  }
}

/** The team settings a board carries (only the ones the team has set) */
export function teamBoardOverlay(stored: TeamSettings | null | undefined): Partial<BoardSettings> {
  const t = teamSettings(stored);
  const out: Partial<BoardSettings> = {};
  if (t.allowAnonymous !== undefined) out.allowAnonymous = t.allowAnonymous;
  if (t.locked !== undefined) out.locked = t.locked;
  if (t.theme !== undefined) out.theme = t.theme;
  return out;
}

async function teamDto(ctx: Ctx, team: Team, user: User): Promise<TeamDto> {
  const [m] = await ctx.db.select({ n: count() }).from(teamMembers).where(eq(teamMembers.teamId, team.id));
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    myRole: await teamRole(ctx.db, user, team.id),
    memberCount: Number(m.n),
    settings: teamSettings(team.settings),
    createdAt: team.createdAt.toISOString(),
  };
}

function inviteDto(i: typeof invites.$inferSelect, teamName?: string): InviteDto {
  return {
    id: i.id, token: i.token, teamId: i.teamId, teamName, email: i.email, role: i.role,
    expiresAt: i.expiresAt?.toISOString() ?? null, maxUses: i.maxUses, uses: i.uses, createdAt: i.createdAt.toISOString(),
  };
}

async function adminCount(ctx: Ctx, teamId: string): Promise<number> {
  const [r] = await ctx.db.select({ n: count() }).from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, 'admin')));
  return Number(r.n);
}

export async function teamRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  app.get('/api/teams', async req => {
    const user = requireUser(req);
    const all = user.guest || ((req.query as { all?: string }).all === '1' && user.role === 'admin');
    const rows = all
      ? await db.select().from(teams).orderBy(teams.name)
      : (await db.select({ t: teams }).from(teamMembers).innerJoin(teams, eq(teams.id, teamMembers.teamId))
          .where(eq(teamMembers.userId, user.id)).orderBy(teams.name)).map(r => r.t);
    return Promise.all(rows.map(t => teamDto(ctx, t, user)));
  });

  app.post('/api/teams', async req => {
    const user = requireUser(req);
    const body = parse(z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(500).default('') }), req.body);
    const [team] = await db.insert(teams).values({ id: newId(), name: body.name, description: body.description, createdBy: user.id }).returning();
    await db.insert(teamMembers).values({ teamId: team.id, userId: user.id, role: 'admin' });
    return teamDto(ctx, team, user);
  });

  app.get('/api/teams/:teamId', async req => {
    const user = requireUser(req);
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId);
    return teamDto(ctx, team, user);
  });

  app.patch('/api/teams/:teamId', async req => {
    const user = requireUser(req);
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId, 'admin');
    const body = parse(z.object({
      name: z.string().trim().min(1).max(80).optional(),
      description: z.string().max(500).optional(),
      settings: zTeamSettings.optional(),
    }), req.body);
    const settings = body.settings
      ? teamSettings({ ...teamSettings(team.settings), ...body.settings, theme: body.settings.theme === undefined ? team.settings?.theme : body.settings.theme ? sanitizeTokens(body.settings.theme) : null } as TeamSettings)
      : team.settings;
    const [updated] = await db.update(teams).set({
      name: body.name ?? team.name,
      description: body.description ?? team.description,
      settings,
    }).where(eq(teams.id, team.id)).returning();
    // Anonymous cards, lock and colors are the team's: its current board follows, live; history stays as it was.
    if (body.settings && TEAM_BOARD_SETTING_KEYS.some(k => k in body.settings!)) await applyToBoards(ctx, updated);
    return teamDto(ctx, updated, user);
  });

  app.delete('/api/teams/:teamId', async (req, reply) => {
    const user = requireUser(req);
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId, 'admin');
    await db.delete(teams).where(eq(teams.id, team.id));
    return noContent(reply);
  });

  // ---- members ----

  app.get('/api/teams/:teamId/members', async (req): Promise<TeamMemberDto[]> => {
    const user = requireUser(req);
    const { role } = await requireTeam(db, user, (req.params as { teamId: string }).teamId);
    const rows = await db.select({ m: teamMembers, u: users }).from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.teamId, (req.params as { teamId: string }).teamId)).orderBy(users.name);
    return rows.map(r => ({ user: toUserDto(r.u, { withEmail: role === 'admin' }), role: r.m.role, joinedAt: r.m.joinedAt.toISOString() }));
  });

  app.post('/api/teams/:teamId/members', async (req, reply) => {
    const user = requireUser(req);
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId, 'admin');
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), role: zRole.default('member') }), req.body);
    const target = await findUserByEmail(db, body.email);
    if (!target) throw notFound('No account uses that email; send an invite link instead. The user');
    await db.insert(teamMembers).values({ teamId: team.id, userId: target.id, role: body.role })
      .onConflictDoUpdate({ target: [teamMembers.teamId, teamMembers.userId], set: { role: body.role } });
    return reply.code(201).send({ ok: true });
  });

  app.patch('/api/teams/:teamId/members/:userId', async (req, reply) => {
    const user = requireUser(req);
    const { teamId, userId } = req.params as { teamId: string; userId: string };
    await requireTeam(db, user, teamId, 'admin');
    const { role } = parse(z.object({ role: zRole }), req.body);
    const [m] = await db.select().from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    if (!m) throw notFound('Member');
    if (m.role === 'admin' && role !== 'admin' && (await adminCount(ctx, teamId)) <= 1) {
      throw badRequest('A team needs at least one admin');
    }
    await db.update(teamMembers).set({ role }).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    return noContent(reply);
  });

  app.delete('/api/teams/:teamId/members/:userId', async (req, reply) => {
    const user = requireUser(req);
    const { teamId, userId } = req.params as { teamId: string; userId: string };
    await requireTeam(db, user, teamId, userId === user.id ? 'viewer' : 'admin');
    const [m] = await db.select().from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    if (!m) throw notFound('Member');
    if (m.role === 'admin' && (await adminCount(ctx, teamId)) <= 1) throw badRequest('A team needs at least one admin');
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    return noContent(reply);
  });

  // ---- invites ----

  app.get('/api/teams/:teamId/invites', async req => {
    const user = requireUser(req);
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId, 'admin');
    const rows = await db.select().from(invites)
      .where(and(eq(invites.teamId, team.id), eq(invites.revoked, false))).orderBy(desc(invites.createdAt));
    return rows.map(i => inviteDto(i, team.name));
  });

  app.post('/api/teams/:teamId/invites', async req => {
    const user = requireUser(req);
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId, 'admin');
    const body = parse(z.object({
      email: z.string().trim().toLowerCase().email().nullable().optional(),
      role: zRole.default('member'),
      expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
      maxUses: z.number().int().min(1).max(10000).nullable().optional(),
    }), req.body);
    const [inv] = await db.insert(invites).values({
      id: newId(),
      teamId: team.id,
      token: newToken(18),
      email: body.email ?? null,
      role: body.role,
      expiresAt: body.expiresInDays === null ? null : new Date(Date.now() + (body.expiresInDays ?? 14) * 86_400_000),
      maxUses: body.maxUses ?? (body.email ? 1 : null),
      createdBy: user.id,
    }).returning();
    return inviteDto(inv, team.name);
  });

  app.delete('/api/invites/:inviteId', async (req, reply) => {
    const user = requireUser(req);
    const [inv] = await db.select().from(invites).where(eq(invites.id, (req.params as { inviteId: string }).inviteId));
    if (!inv) throw notFound('Invite');
    await requireTeam(db, user, inv.teamId, 'admin');
    await db.update(invites).set({ revoked: true }).where(eq(invites.id, inv.id));
    return noContent(reply);
  });

  /** Public: lets the invite page say which team you are joining before you sign in. */
  app.get('/api/invites/by-token/:token', async req => {
    const { invite, teamName } = await findValidInvite(db, (req.params as { token: string }).token);
    return { teamName, role: invite.role, email: invite.email };
  });

  app.post('/api/invites/by-token/:token/accept', async req => {
    const user = requireUser(req);
    const teamId = await acceptInvite(db, (req.params as { token: string }).token, user);
    return { teamId };
  });

  // ---- templates ----

  app.get('/api/teams/:teamId/templates', async (req): Promise<TemplateDto[]> => {
    const user = requireUser(req);
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId);
    const rows = await db.select().from(templates).where(or(eq(templates.teamId, team.id), isNull(templates.teamId))).orderBy(templates.name);
    return [
      ...rows.filter(t => t.teamId).map(t => ({ id: t.id, name: t.name, description: t.description, columns: t.columns, builtIn: false })),
      ...rows.filter(t => !t.teamId).map(t => ({ id: t.id, name: t.name, description: t.description, columns: t.columns, builtIn: false, instance: true })),
      ...BUILT_IN_TEMPLATES,
    ];
  });

  app.post('/api/teams/:teamId/templates', async (req): Promise<TemplateDto> => {
    const user = requireUser(req);
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId, 'admin');
    const body = parse(z.object({
      name: z.string().trim().min(1).max(80),
      description: z.string().max(300).default(''),
      columns: z.array(z.object({ title: z.string().trim().min(1).max(80), color: zColor, description: z.string().max(300).optional() })).min(1).max(12),
    }), req.body);
    const [t] = await db.insert(templates).values({ id: newId(), teamId: team.id, ...body }).returning();
    return { id: t.id, name: t.name, description: t.description, columns: t.columns, builtIn: false };
  });

  app.delete('/api/templates/:templateId', async (req, reply) => {
    const user = requireUser(req);
    const [t] = await db.select().from(templates).where(eq(templates.id, (req.params as { templateId: string }).templateId));
    if (!t) throw notFound('Template');
    if (t.teamId) await requireTeam(db, user, t.teamId, 'admin');
    else requireAdmin(req);
    await db.delete(templates).where(eq(templates.id, t.id));
    return noContent(reply);
  });

  // ---- history, actions, search ----

  app.get('/api/teams/:teamId/boards', async req => {
    const user = requireUser(req);
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId);
    const status = (req.query as { status?: string }).status;
    const where = status && ['open', 'archived'].includes(status)
      ? and(eq(boards.teamId, team.id), eq(boards.status, status as 'open'))
      : eq(boards.teamId, team.id);
    return boardDtos(db, await db.select().from(boards).where(where).orderBy(desc(boards.createdAt)));
  });

  app.get('/api/teams/:teamId/actions', async req => {
    const user = requireUser(req);
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId);
    const status = (req.query as { status?: string }).status;
    return loadActions(db, status === 'open' || status === 'done'
      ? and(eq(actionItems.teamId, team.id), eq(actionItems.status, status))
      : eq(actionItems.teamId, team.id));
  });

  app.get('/api/teams/:teamId/carry-over', async req => {
    const user = requireUser(req);
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId);
    const teamBoards = db.select({ id: boards.id }).from(boards).where(eq(boards.teamId, team.id));
    const [pending] = await db.select({ n: count() }).from(cards).where(and(
      inArray(cards.boardId, teamBoards), eq(cards.status, 'carry_over'), isNull(cards.carriedToBoardId),
    ));
    const [open] = await db.select({ n: count() }).from(actionItems)
      .where(and(eq(actionItems.teamId, team.id), eq(actionItems.status, 'open')));
    return { cards: Number(pending.n), openActions: Number(open.n) };
  });

  app.get('/api/teams/:teamId/search', async (req): Promise<SearchResultDto> => {
    const user = requireUser(req);
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId);
    const q = String((req.query as { q?: string }).q ?? '').trim();
    if (q.length < 2) throw badRequest('Search for at least 2 characters');
    const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
    const cardRows = await db.select({ card: { id: cards.id, body: cards.body, status: cards.status }, board: { id: boards.id, title: boards.title } })
      .from(cards).innerJoin(boards, eq(boards.id, cards.boardId))
      .where(and(eq(boards.teamId, team.id), or(ilike(cards.body, like), ilike(cards.groupTitle, like))))
      .orderBy(desc(cards.createdAt)).limit(50);
    const actions = await loadActions(db, and(eq(actionItems.teamId, team.id), ilike(actionItems.title, like)));
    return { cards: cardRows, actions: actions.slice(-50) };
  });


}
