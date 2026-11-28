import { eq, isNotNull } from 'drizzle-orm';
import { loadConfig } from './config';
import { openDatabase } from './db';
import { teams } from './db/schema';
import { hasAdmin, newAdminCode } from './lib/admin-code';
import { decryptFile, encryptFile, isEncrypted } from './lib/backup-crypto';

/**
 * Server-side tools, for whoever runs Retro Board:
 *
 *   node dist/cli.js unlock            lists the teams that have a password
 *   node dist/cli.js unlock <team>     removes a team's password (by name or id), for when it's forgotten
 *                                      and the browser that set it is gone too
 *   node dist/cli.js encrypt <in> <out> encrypts a backup file with the passphrase given on stdin
 *   node dist/cli.js decrypt <in> <out> the other way round (a wrong passphrase fails, writing nothing)
 *   node dist/cli.js encrypted <file>   exits 0 when the file is an encrypted backup
 *   node dist/cli.js admin-code          a new setup code: typed on the site (no-sign-in mode), it makes that visitor
 *                                       a site admin. --if-no-admin: only when nobody is admin yet (for launch.sh)
 *
 * Docker: ./launch.sh unlock <team>. With the embedded database (pglite:), stop the app first.
 */
const [cmd, ...rest] = process.argv.slice(2);
const usage = 'Usage: cli.js unlock [team name or id] | admin-code [--if-no-admin] | encrypt <in> <out> | decrypt <in> <out> | encrypted <file>';

/** The passphrase, piped in so it never shows on a command line or in the process list */
async function readPassphrase(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

if (cmd === 'encrypted' && rest.length === 1) process.exit((await isEncrypted(rest[0])) ? 0 : 1);
if ((cmd === 'encrypt' || cmd === 'decrypt') && rest.length === 2) {
  try {
    const pass = await readPassphrase();
    await (cmd === 'encrypt' ? encryptFile : decryptFile)(rest[0], rest[1], pass);
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
if (cmd === 'admin-code') {
  const config = loadConfig();
  const { db, close } = await openDatabase(config.databaseUrl);
  try {
    if (config.authMode !== 'none') {
      if (!rest.includes('--if-no-admin')) console.log('This site uses accounts: the first account made is its admin, and admins promote others on the Admin page.');
    } else if (rest.includes('--if-no-admin') && (await hasAdmin(db))) {
      // someone runs the site already: nothing to say
    } else {
      const code = await newAdminCode(db);
      console.log(`Admin setup code: ${code}`);
      console.log('Open the site, choose "Claim Admin" (or go to /claim-admin) and type it. It works once; any earlier code stops working.');
    }
  } finally {
    await close();
  }
  process.exit(0);
}
if (cmd !== 'unlock') {
  console.error(usage);
  process.exit(2);
}

const config = loadConfig();
const { db, close } = await openDatabase(config.databaseUrl);
try {
  const locked = await db.select({ id: teams.id, name: teams.name }).from(teams).where(isNotNull(teams.passwordHash)).orderBy(teams.name);
  const want = rest.join(' ').trim();
  if (!want) {
    if (!locked.length) console.log('No team has a password.');
    else {
      console.log('Teams with a password:');
      for (const t of locked) console.log(`  ${t.name}  (${t.id})`);
      console.log('Remove one with: unlock <team name or id>');
    }
  } else {
    const matches = locked.filter(t => t.id === want || t.name.toLowerCase() === want.toLowerCase());
    if (matches.length !== 1) {
      console.error(matches.length ? `More than one team is called "${want}"; use its id:` : `No team with a password matches "${want}".`);
      for (const t of matches.length ? matches : locked) console.error(`  ${t.name}  (${t.id})`);
      process.exitCode = 1;
    } else {
      const [t] = matches;
      const [row] = await db.select({ v: teams.passwordVersion }).from(teams).where(eq(teams.id, t.id));
      await db.update(teams).set({ passwordHash: null, ownerKeyHash: null, passwordVersion: (row?.v ?? 0) + 1 }).where(eq(teams.id, t.id));
      console.log(`Removed the password from "${t.name}". A team admin can set a new one in the team's Settings.`);
    }
  }
} finally {
  await close();
}
