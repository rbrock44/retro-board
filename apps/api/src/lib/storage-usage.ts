import { isNotNull } from 'drizzle-orm';
import type { Db } from '../db';
import { attachments } from '../db/schema';

/** What uploads use: each stored file counted once, since carried-over cards point at the same file */
export async function uploadUsage(db: Db): Promise<{ bytes: number; files: number }> {
  const rows = await db.select({ key: attachments.storageKey, size: attachments.size }).from(attachments).where(isNotNull(attachments.storageKey));
  const seen = new Map<string, number>();
  for (const r of rows) if (r.key && !seen.has(r.key)) seen.set(r.key, r.size ?? 0);
  let bytes = 0;
  for (const size of seen.values()) bytes += size;
  return { bytes, files: seen.size };
}
