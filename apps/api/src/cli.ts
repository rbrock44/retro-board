import { eq, isNotNull } from 'drizzle-orm';
import { loadConfig } from './config';
import { openDatabase } from './db';
import { teams } from './db/schema';

/**
 * Server-side tools, for whoever runs Retro Board:
 *
 *   node dist/cli.js unlock            lists the teams that have a password
 *   node dist/cli.js unlock <team>     removes a team's password (by name or id), for when it's forgotten
 *                                      and the browser that set it is gone too
 *
 * Docker: ./launch.sh unlock <team>. With the embedded database (pglite:), stop the app first.
 */
const [cmd, ...rest] = process.argv.slice(2);
const usage = 'Usage: cli.js unlock [team name or id]';

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
