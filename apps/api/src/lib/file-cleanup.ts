import { and, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import type { Ctx } from '../context';
import { attachments, teams } from '../db/schema';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** Where uploads live in storage; the sweep never looks anywhere else (a shared bucket may hold other things) */
const PREFIXES = ['boards/', 'teams/'];

/** The stored files of the attachments `where` picks, to pass to dropUnusedFiles once their rows are gone */
export async function attachmentFiles(ctx: Ctx, where: SQL | undefined): Promise<string[]> {
  const rows = await ctx.db.select({ storageKey: attachments.storageKey, thumbKey: attachments.thumbKey }).from(attachments).where(where);
  return rows.flatMap(r => [r.storageKey, r.thumbKey]).filter((k): k is string => !!k);
}

/**
 * Removes the stored files among `keys` that nothing points at any more. Carried-over cards share files with the
 * card they came from, so a file stays as long as any attachment (or team photo) still uses it.
 */
export async function dropUnusedFiles(ctx: Ctx, keys: (string | null | undefined)[]) {
  const wanted = [...new Set(keys.filter((k): k is string => !!k))];
  if (!wanted.length) return;
  const used = new Set<string>();
  const rows = await ctx.db.select({ storageKey: attachments.storageKey, thumbKey: attachments.thumbKey }).from(attachments)
    .where(or(inArray(attachments.storageKey, wanted), inArray(attachments.thumbKey, wanted)));
  for (const r of rows) { if (r.storageKey) used.add(r.storageKey); if (r.thumbKey) used.add(r.thumbKey); }
  const photos = await ctx.db.select({ photoKey: teams.photoKey }).from(teams).where(inArray(teams.photoKey, wanted));
  for (const t of photos) if (t.photoKey) used.add(t.photoKey);
  for (const key of wanted) if (!used.has(key)) await ctx.storage.remove(key).catch(() => {});
}

/**
 * Sweeps up storage nothing uses:
 * - uploads never put on a card or reply (the add-card box was closed), once a day old
 * - files no row points at, left behind by deletes in older versions, once an hour old (an upload in progress
 *   writes its file a moment before its row)
 */
export async function sweepFiles(ctx: Ctx, now = Date.now()): Promise<{ removed: number }> {
  const stale = await ctx.db.delete(attachments)
    .where(and(isNull(attachments.cardId), isNull(attachments.replyId), lt(attachments.createdAt, new Date(now - DAY))))
    .returning({ storageKey: attachments.storageKey, thumbKey: attachments.thumbKey });
  await dropUnusedFiles(ctx, stale.flatMap(r => [r.storageKey, r.thumbKey]));

  const used = new Set<string>();
  for (const r of await ctx.db.select({ storageKey: attachments.storageKey, thumbKey: attachments.thumbKey }).from(attachments)) {
    if (r.storageKey) used.add(r.storageKey);
    if (r.thumbKey) used.add(r.thumbKey);
  }
  for (const t of await ctx.db.select({ photoKey: teams.photoKey }).from(teams)) if (t.photoKey) used.add(t.photoKey);

  let removed = 0;
  for (const prefix of PREFIXES) {
    for await (const f of ctx.storage.list(prefix)) {
      if (used.has(f.key) || f.modified.getTime() > now - HOUR) continue;
      await ctx.storage.remove(f.key).catch(() => {});
      removed++;
    }
  }
  return { removed };
}
