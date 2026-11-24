import { and, eq, gt, lt } from 'drizzle-orm';
import type { Db } from '../db';
import { sessions, users, type User } from '../db/schema';
import { newToken, sha256 } from '../lib/ids';

export const SESSION_COOKIE = 'rb_session';
export const OAUTH_COOKIE = 'rb_oauth';

export async function createSession(db: Db, userId: string, days: number, userAgent: string | null): Promise<string> {
  const token = newToken();
  await db.insert(sessions).values({
    id: sha256(token),
    userId,
    userAgent: userAgent?.slice(0, 300) ?? null,
    expiresAt: new Date(Date.now() + days * 86_400_000),
  });
  return token;
}

export async function userForToken(db: Db, token: string | undefined): Promise<{ user: User; sessionId: string } | null> {
  if (!token) return null;
  const id = sha256(token);
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || row.user.disabled) return null;
  return { user: row.user, sessionId: id };
}

export async function deleteSession(db: Db, sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function deleteUserSessions(db: Db, userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function pruneSessions(db: Db) {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
