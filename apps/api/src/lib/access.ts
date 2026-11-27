import { and, eq } from 'drizzle-orm';
import {
  canFacilitate, canVoteBoard, canWriteBoard, type BoardAccess, type BoardPermissions, type TeamRole,
} from '@retro/shared';
import type { Db } from '../db';
import { boards, cards, columns, replies, teamMembers, teams, type Board, type Team, type User } from '../db/schema';
import { forbidden, notFound } from './http';
import { requireOpen } from './team-lock';

const RANK: Record<TeamRole, number> = { viewer: 1, member: 2, admin: 3 };

export function atLeast(role: TeamRole | null, min: TeamRole): boolean {
  return !!role && RANK[role] >= RANK[min];
}

/** Instance admins act as team admins everywhere. */
export async function teamRole(db: Db, user: User, teamId: string): Promise<TeamRole | null> {
  if (user.guest) {
    // No-sign-in mode: everyone can do everything. Joining on first visit puts them in member lists
    // (action owners, presence) like anyone else.
    await db.insert(teamMembers).values({ teamId, userId: user.id, role: 'admin' }).onConflictDoNothing();
    return 'admin';
  }
  if (user.role === 'admin') return 'admin';
  const [m] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id)))
    .limit(1);
  return m?.role ?? null;
}

/**
 * The team, if this person may use it. A team with a password also needs this browser to have unlocked it
 * (`skipPassword` is for the routes that do the unlocking, and the photo shown on the prompt).
 */
export async function requireTeam(
  db: Db, user: User, teamId: string, min: TeamRole = 'viewer', opts: { skipPassword?: boolean } = {},
): Promise<{ team: Team; role: TeamRole }> {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) throw notFound('Team');
  const role = await teamRole(db, user, teamId);
  if (!role) throw notFound('Team');
  if (!opts.skipPassword) requireOpen(team, user);
  if (!atLeast(role, min)) throw forbidden(`Team ${min}s only`);
  return { team, role };
}

export interface BoardContext {
  board: Board;
  role: TeamRole;
  access: BoardAccess;
  permissions: BoardPermissions;
}

export function boardPermissions(board: Board, role: TeamRole, userId: string): { access: BoardAccess; permissions: BoardPermissions } {
  const access: BoardAccess = {
    role,
    isCreator: board.createdBy === userId,
    status: board.status,
    locked: !!board.settings.locked,
  };
  return {
    access,
    permissions: {
      role,
      canWrite: canWriteBoard(access),
      canVote: canVoteBoard(access),
      canFacilitate: canFacilitate(access),
    },
  };
}

export type BoardNeed = 'read' | 'write' | 'vote' | 'facilitate' | 'admin';

export async function requireBoard(db: Db, user: User, boardId: string, need: BoardNeed = 'read'): Promise<BoardContext> {
  const [board] = await db.select().from(boards).where(eq(boards.id, boardId)).limit(1);
  if (!board) throw notFound('Board');
  const role = await teamRole(db, user, board.teamId);
  if (!role) throw notFound('Board');
  const [lock] = await db.select({
    id: teams.id, name: teams.name, passwordHash: teams.passwordHash, passwordVersion: teams.passwordVersion, ownerKeyHash: teams.ownerKeyHash,
  }).from(teams).where(eq(teams.id, board.teamId)).limit(1);
  if (lock) requireOpen(lock, user);
  const { access, permissions } = boardPermissions(board, role, user.id);
  const ok =
    need === 'read' ||
    (need === 'write' && permissions.canWrite) ||
    (need === 'vote' && permissions.canVote) ||
    (need === 'facilitate' && permissions.canFacilitate) ||
    (need === 'admin' && role === 'admin');
  if (!ok) {
    if (board.status !== 'open' && need !== 'facilitate' && need !== 'admin') throw forbidden('This board is closed');
    if (board.settings.locked && need === 'write') throw forbidden('This board is locked');
    throw forbidden();
  }
  return { board, role, access, permissions };
}

export async function boardIdForColumn(db: Db, columnId: string): Promise<string> {
  const [c] = await db.select({ boardId: columns.boardId }).from(columns).where(eq(columns.id, columnId)).limit(1);
  if (!c) throw notFound('Column');
  return c.boardId;
}

export async function loadCard(db: Db, cardId: string) {
  const [c] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!c) throw notFound('Card');
  return c;
}

export async function loadReply(db: Db, replyId: string) {
  const [r] = await db.select().from(replies).where(eq(replies.id, replyId)).limit(1);
  if (!r) throw notFound('Reply');
  return r;
}

/** Authors edit their own things; facilitators edit anything on their board. */
export function canEditOwn(ctx: BoardContext, authorId: string | null, userId: string): boolean {
  return ctx.permissions.canFacilitate || (!!authorId && authorId === userId);
}
