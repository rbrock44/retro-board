import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  close(): Promise<void>;
}

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MIGRATIONS_DIR,
    resolve(here, 'drizzle'), // bundled: dist/main.js + dist/drizzle
    resolve(here, '../../drizzle'), // source: src/db/index.ts
  ].filter((p): p is string => !!p);
  const found = candidates.find(p => existsSync(resolve(p, 'meta/_journal.json')));
  if (!found) throw new Error(`No migrations found in ${candidates.join(', ')}`);
  return found;
}

/**
 * Opens the database and applies pending migrations.
 * `postgres://…` uses a real Postgres server; `pglite:<dir>` and `memory` use embedded PGlite,
 * which needs no server at all and is what local dev and the tests run on.
 */
export async function openDatabase(url: string): Promise<Database> {
  const migrationsFolder = migrationsDir();

  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    const { Pool } = (await import('pg')).default;
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new Pool({ connectionString: url, max: 10 });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder });
    return { db: db as unknown as Db, close: () => pool.end() };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  let client;
  if (url === 'memory') {
    client = new PGlite();
  } else {
    const dir = resolve(url.replace(/^pglite:/, ''));
    mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
  }
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => client.close() };
}

export { schema };
