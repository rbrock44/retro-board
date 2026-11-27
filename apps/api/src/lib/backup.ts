import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createGunzip, createGzip } from 'node:zlib';
import { getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Ctx } from '../context';
import { migrationCount } from '../db';
import {
  actionItems, attachments, boards, cards, columns, identities, instanceSettings, invites, reactions, replies, teamMembers,
  teams, templates, users, votes,
} from '../db/schema';
import { badRequest } from './http';
import { tarStream, untar } from './tar';

/**
 * Backups made in the app (Admin → Customize → Your Data): every table as JSON plus every uploaded file, in one
 * .tar.gz. Unlike `./launch.sh backup` (a pg_dump), this works on any host and any database the app runs on.
 * Sign-in sessions are left out, so a backup never holds a live session, and after a restore everyone signs in again.
 */

export const MANIFEST = 'retro-board-backup.json';
const FORMAT = 1;

/** Every table, parents before children, so rows can go back in this order (and come out in reverse). */
const TABLES: Record<string, PgTable> = {
  users, identities, teams, teamMembers, invites, templates, boards, columns, cards, replies, attachments, votes,
  reactions, actionItems, instanceSettings,
};

interface Manifest {
  app: 'retro-board';
  format: number;
  /** The app's migration count when it was made: a backup from a newer app can't go into an older one. */
  migrations: number;
  createdAt: string;
  tables: Record<string, Record<string, unknown>[]>;
  files: { key: string; mime: string }[];
}

/** Uploaded files and their types, found through the rows that point at them (storage itself can't be listed). */
function filesIn(tables: Manifest['tables']): Manifest['files'] {
  const seen = new Map<string, string>();
  for (const a of tables.attachments ?? []) {
    if (a.storageKey) seen.set(String(a.storageKey), String(a.mime));
    if (a.thumbKey) seen.set(String(a.thumbKey), 'image/webp');
  }
  for (const t of tables.teams ?? []) if (t.photoKey) seen.set(String(t.photoKey), 'image/webp');
  return [...seen].map(([key, mime]) => ({ key, mime }));
}

async function toBuffer(stream: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of stream) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

/** The whole instance as a .tar.gz stream: the manifest first, then each file. */
export async function backupStream(ctx: Ctx): Promise<Readable> {
  const tables: Manifest['tables'] = {};
  // one transaction, so the tables agree with each other
  await ctx.db.transaction(async tx => {
    for (const [name, table] of Object.entries(TABLES)) tables[name] = await tx.select().from(table) as Record<string, unknown>[];
  });
  const manifest: Manifest = {
    app: 'retro-board', format: FORMAT, migrations: migrationCount(), createdAt: new Date().toISOString(), tables, files: filesIn(tables),
  };
  async function* entries() {
    yield { name: MANIFEST, data: Buffer.from(JSON.stringify(manifest)) };
    for (const f of manifest.files) {
      const got = await ctx.storage.get(f.key).catch(() => null);
      if (got) yield { name: `files/${f.key}`, data: await toBuffer(got.stream) };
    }
  }
  return Readable.from(tarStream(entries())).pipe(createGzip());
}

function readArchive(path: string) {
  return untar(createReadStream(path).pipe(createGunzip()));
}

/** Checks a backup file before anything is touched; returns its manifest. */
async function readManifest(path: string): Promise<Manifest> {
  let manifest: Manifest | null = null;
  try {
    for await (const e of readArchive(path)) {
      if (e.name === MANIFEST) { manifest = JSON.parse(e.data.toString('utf8')) as Manifest; break; }
    }
  } catch {
    throw badRequest("That isn't a Retro Board backup (it couldn't be read)");
  }
  if (!manifest || manifest.app !== 'retro-board' || typeof manifest.tables !== 'object') {
    throw badRequest("That isn't a backup made in Admin → Your Data. A ./launch.sh backup goes back with ./launch.sh restore");
  }
  if (manifest.format > FORMAT || manifest.migrations > migrationCount()) {
    throw badRequest('That backup was made by a newer version of Retro Board. Update this one first, then restore');
  }
  return manifest;
}

/** Turns a JSON row back into what the table takes: only columns this version has, dates as dates. */
function revive(table: PgTable, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(getTableColumns(table))) {
    if (!(key in row)) continue;
    const v = row[key];
    out[key] = col.columnType === 'PgTimestamp' && typeof v === 'string' ? new Date(v) : v;
  }
  return out;
}

/**
 * Replaces everything with the backup: files go into storage first, then every table is emptied and refilled in
 * one transaction, so a failure part way leaves the current data as it was. Files that only the old data used are
 * left in storage.
 */
export async function restoreBackup(ctx: Ctx, path: string): Promise<{ rows: number; files: number }> {
  const manifest = await readManifest(path);
  const wanted = new Map(manifest.files.map(f => [`files/${f.key}`, f]));
  let files = 0;
  for await (const e of readArchive(path)) {
    const f = wanted.get(e.name);
    if (!f) continue;
    await ctx.storage.put(f.key, e.data, f.mime);
    files++;
  }
  let rows = 0;
  await ctx.db.transaction(async tx => {
    const order = Object.entries(TABLES);
    for (const [, table] of [...order].reverse()) await tx.delete(table);
    for (const [name, table] of order) {
      const list = (manifest.tables[name] ?? []).map(r => revive(table, r));
      for (let i = 0; i < list.length; i += 200) {
        await tx.insert(table).values(list.slice(i, i + 200));
      }
      rows += list.length;
    }
  });
  return { rows, files };
}
