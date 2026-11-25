import { generateKeyBetween } from 'fractional-indexing';
import type { BoardStatus, TeamRole } from './models';

/** Position key that sorts between two neighbours (either may be null for the ends). */
export function positionBetween(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) return generateKeyBetween(before, null);
  return generateKeyBetween(before, after);
}

export function positionAfter(last: string | null): string {
  return generateKeyBetween(last, null);
}

export function byPosition<T extends { position: string; id: string }>(a: T, b: T): number {
  if (a.position < b.position) return -1;
  if (a.position > b.position) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface BoardAccess {
  role: TeamRole | null;
  isCreator: boolean;
  status: BoardStatus;
  locked: boolean;
}

export function canFacilitate(a: BoardAccess): boolean {
  return a.role === 'admin' || (a.isCreator && a.role === 'member');
}

/** Adding and editing cards, replies and columns. */
export function canWriteBoard(a: BoardAccess): boolean {
  if (a.status !== 'open') return false;
  if (a.role !== 'admin' && a.role !== 'member') return false;
  return !a.locked || canFacilitate(a);
}

/** Likes and reactions still work on a locked board, so a team can lock writing and then like cards. */
export function canVoteBoard(a: BoardAccess): boolean {
  return a.status === 'open' && (a.role === 'admin' || a.role === 'member');
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * A stable hue (0-359) for a person, from their user id, so their cards get the same shade on every board and
 * device. FNV-1a (32-bit) of the id, then a Fibonacci (golden-ratio) multiply so similar ids land far apart,
 * scaled from the top bits onto the colour wheel.
 * Never call this for an anonymous card: the shade would give its author away.
 */
export function personHue(userId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const spread = Math.imul(h, 0x9e3779b9) >>> 0;
  return Math.floor((spread / 2 ** 32) * 360);
}
