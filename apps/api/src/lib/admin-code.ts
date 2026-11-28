import { randomInt, timingSafeEqual } from 'node:crypto';
import { and, count, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { instanceSettings, users } from '../db/schema';
import { sha256 } from './ids';

/**
 * No-sign-in mode's site admin. Visitors are regular guests; whoever types a setup code becomes a site admin.
 * The code is made on the server (`./launch.sh admin-code`), works once, and only its hash is kept.
 */

const KEY = 'admin-code';
/** No 0/O, 1/I/L: easy to read off a terminal and type */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A fresh code like `K7QM-3XNP-WD9R` (about 60 bits); any earlier one stops working */
export async function newAdminCode(db: Db): Promise<string> {
  const raw = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  const code = raw.match(/.{4}/g)!.join('-');
  const value = { hash: sha256(raw), createdAt: new Date().toISOString() };
  await db.insert(instanceSettings).values({ id: KEY, value })
    .onConflictDoUpdate({ target: instanceSettings.id, set: { value, updatedAt: new Date() } });
  return code;
}

/** Uses up the code if it's the current one. Spaces, dashes and case don't matter. */
export async function useAdminCode(db: Db, typed: string): Promise<boolean> {
  const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.id, KEY));
  const hash = typeof row?.value['hash'] === 'string' ? row.value['hash'] : null;
  if (!hash) return false;
  const given = Buffer.from(sha256(typed.toUpperCase().replace(/[^A-Z0-9]/g, '')));
  const ok = given.length === hash.length && timingSafeEqual(given, Buffer.from(hash));
  if (ok) await db.delete(instanceSettings).where(eq(instanceSettings.id, KEY));
  return ok;
}

/** Does anyone run the site yet (an active site admin)? */
export async function hasAdmin(db: Db): Promise<boolean> {
  const [r] = await db.select({ n: count() }).from(users).where(and(eq(users.role, 'admin'), eq(users.disabled, false)));
  return Number(r.n) > 0;
}
