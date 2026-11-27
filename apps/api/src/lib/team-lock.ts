import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { AppConfig } from '../config';
import type { Team, User } from '../db/schema';
import { HttpError } from './http';

/**
 * Team passwords. A team with one shows its boards only to browsers that typed it (or the browser that set it).
 *
 * - Typing it sets `rb_unlock_<team>`: the password's version, signed. Changing the password bumps the version,
 *   so every browser has to type the new one
 * - The browser that sets it also gets `rb_owner_<team>`: a random key whose hash the team keeps. That browser
 *   always gets in and may set a new password without the old one (for when it's forgotten)
 * - If both the password and that browser are lost, whoever runs the server clears it: `./launch.sh unlock <team>`
 */

const UNLOCK = 'rb_unlock_';
const OWNER = 'rb_owner_';
const TEN_YEARS = 10 * 365 * 24 * 3600;

export interface TeamKeys {
  /** team id → the password version this browser unlocked */
  unlocked: Map<string, number>;
  /** team id → this browser's original-browser key */
  owner: Map<string, string>;
}

/** What each signed-in user's browser holds, by user object (requests and sockets each have their own). */
const keysByUser = new WeakMap<User, TeamKeys>();

function sign(secret: string, teamId: string, version: number): string {
  return createHmac('sha256', secret).update(`${teamId}:${version}`).digest('base64url');
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Reads the team cookies from a request's (or socket's) cookies and remembers them for this user object. */
export function attachTeamKeys(user: User, cookies: Record<string, string | undefined>, secret: string) {
  const keys: TeamKeys = { unlocked: new Map(), owner: new Map() };
  for (const [name, value] of Object.entries(cookies)) {
    if (!value) continue;
    if (name.startsWith(UNLOCK)) {
      const teamId = name.slice(UNLOCK.length);
      const [v, mac] = value.split('.');
      const version = Number(v);
      if (Number.isInteger(version) && mac && sameText(mac, sign(secret, teamId, version))) keys.unlocked.set(teamId, version);
    } else if (name.startsWith(OWNER)) {
      keys.owner.set(name.slice(OWNER.length), value);
    }
  }
  keysByUser.set(user, keys);
}

type LockFields = Pick<Team, 'id' | 'passwordHash' | 'passwordVersion' | 'ownerKeyHash'>;

/** Is this the browser that set the team's password? */
export function isLockOwner(team: LockFields, user: User): boolean {
  const key = keysByUser.get(user)?.owner.get(team.id);
  return !!key && !!team.ownerKeyHash && sameText(sha256(key), team.ownerKeyHash);
}

/** May this browser see the team's boards? */
export function teamOpen(team: LockFields, user: User): boolean {
  if (!team.passwordHash) return true;
  return keysByUser.get(user)?.unlocked.get(team.id) === team.passwordVersion || isLockOwner(team, user);
}

/** 423 with the team's id and name, which the web app turns into a password prompt. */
export function requireOpen(team: LockFields & { name: string }, user: User) {
  if (!teamOpen(team, user)) throw new HttpError(423, 'This team has a password', { lockedTeam: { id: team.id, name: team.name } });
}

function cookieOptions(config: AppConfig) {
  return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: config.cookieSecure, maxAge: TEN_YEARS };
}

export function setUnlocked(reply: FastifyReply, config: AppConfig, teamId: string, version: number) {
  reply.setCookie(UNLOCK + teamId, `${version}.${sign(config.sessionSecret, teamId, version)}`, cookieOptions(config));
}

/** Makes this browser the original one: returns the hash to keep on the team. */
export function makeOwner(reply: FastifyReply, config: AppConfig, teamId: string): string {
  const key = randomBytes(32).toString('base64url');
  reply.setCookie(OWNER + teamId, key, cookieOptions(config));
  return sha256(key);
}

export function clearTeamCookies(reply: FastifyReply, config: AppConfig, teamId: string) {
  const o = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: config.cookieSecure };
  reply.clearCookie(UNLOCK + teamId, o);
  reply.clearCookie(OWNER + teamId, o);
}

/** Slows password guessing: a few tries a minute per team and address. */
const tries = new Map<string, { n: number; until: number }>();
export function guessAllowed(key: string): boolean {
  const now = Date.now();
  const t = tries.get(key);
  if (!t || t.until < now) return true;
  return t.n < 8;
}
export function noteWrongGuess(key: string) {
  const now = Date.now();
  const t = tries.get(key);
  if (!t || t.until < now) tries.set(key, { n: 1, until: now + 60_000 });
  else t.n++;
  if (tries.size > 10_000) for (const [k, v] of tries) if (v.until < now) tries.delete(k);
}
