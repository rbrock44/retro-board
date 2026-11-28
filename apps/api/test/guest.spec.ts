import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { teamMembers, users } from '../src/db/schema';
import { newAdminCode } from '../src/lib/admin-code';
import { Client, makeApp, signUp, type TestApp } from './helpers';

let t: TestApp;
afterEach(async () => t?.close());

/** A guest joins a team the only way there is: an invite link from one of its admins */
async function joinTeam(admin: Client, guestClient: Client, teamId: string, role = 'member') {
  const { token } = (await admin.post(`/api/teams/${teamId}/invites`, { role })).body as { token: string };
  expect((await guestClient.post(`/api/invites/by-token/${token}/accept`)).status).toBe(200);
}

async function guest(app: TestApp['app']) {
  const c = new Client(app);
  const me = await c.post('/api/auth/guest');
  expect(me.status).toBe(200);
  return { c, me: me.body };
}

describe('no-sign-in mode (AUTH_MODE=none)', () => {
  it('turns off accounts and hands out guest identities', async () => {
    t = await makeApp({ env: { AUTH_MODE: 'none' } });
    const anon = new Client(t.app);
    const cfg = (await anon.get('/api/auth/config')).body;
    expect(cfg.mode).toBe('none');
    expect(cfg.local.enabled).toBe(false);
    expect(cfg.providers).toEqual([]);
    expect((await anon.post('/api/auth/signup', { email: 'a@b.co', name: 'A', password: 'longenough1' })).status).toBe(404);
    expect((await anon.post('/api/auth/login', { email: 'a@b.co', password: 'longenough1' })).status).toBe(404);
    expect((await anon.get('/api/teams')).status).toBe(401);

    const { c, me } = await guest(t.app);
    expect(me).toMatchObject({ guest: true, needsName: true, name: 'Guest', role: 'user' });
    // calling again keeps the same identity
    expect((await c.post('/api/auth/guest')).body.id).toBe(me.id);
    expect((await c.get('/api/auth/me')).body.id).toBe(me.id);
  });

  it('makes the site admin whoever types the setup code, once', async () => {
    t = await makeApp({ env: { AUTH_MODE: 'none' } });
    const a = await guest(t.app);
    const b = await guest(t.app);
    expect((await a.c.get('/api/auth/config')).body.needsAdmin).toBe(true);
    expect((await a.c.get('/api/admin/users')).status).toBe(403);

    expect((await a.c.post('/api/auth/admin-code', { code: 'nope-nope-nope' })).status).toBe(400);
    const code = await newAdminCode(t.ctx.db);
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const claimed = await a.c.post('/api/auth/admin-code', { code: code.toLowerCase().replace(/-/g, ' ') });
    expect(claimed.body).toMatchObject({ id: a.me.id, role: 'admin' });
    expect((await a.c.get('/api/admin/users')).status).toBe(200);
    expect((await a.c.get('/api/auth/config')).body.needsAdmin).toBe(false);
    // it works once
    expect((await b.c.post('/api/auth/admin-code', { code })).status).toBe(400);

    // nobody takes over the admin by saying "that's me"
    await a.c.patch('/api/auth/me', { name: 'Ada' });
    expect((await b.c.post('/api/auth/guest/claim', { userId: a.me.id })).status).toBe(404);

    // the admin makes a co-admin from the Admin page
    expect((await a.c.patch(`/api/admin/users/${b.me.id}`, { role: 'admin' })).status).toBe(204);
    expect((await b.c.get('/api/admin/users')).status).toBe(200);
  });

  it('demotes the guests an older version made admins, keeping each team its creator', async () => {
    t = await makeApp({ env: { AUTH_MODE: 'none' } });
    const a = await guest(t.app);
    const b = await guest(t.app);
    const team = (await a.c.post('/api/teams', { name: 'Old team' })).body;
    await t.ctx.db.insert(teamMembers).values({ teamId: team.id, userId: b.me.id, role: 'member' });
    // as the older version left things: everyone a site admin and an admin of every team they opened
    await t.ctx.db.update(users).set({ role: 'admin' });
    await t.ctx.db.update(teamMembers).set({ role: 'admin' });
    const migration = readFileSync(join(__dirname, '../drizzle/0010_guests_not_admins.sql'), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) await t.ctx.db.execute(sql.raw(statement));
    expect((await t.ctx.db.select().from(users)).every(u => u.role === 'user')).toBe(true);
    const roles = Object.fromEntries((await t.ctx.db.select().from(teamMembers).where(eq(teamMembers.teamId, team.id))).map(m => [m.userId, m.role]));
    expect(roles).toEqual({ [a.me.id]: 'admin', [b.me.id]: 'member' });
  });

  it("makes a team's creator its admin; others join by invite link, and team admins manage them", async () => {
    t = await makeApp({ env: { AUTH_MODE: 'none' } });
    const a = await guest(t.app);
    const b = await guest(t.app);
    const team = (await a.c.post('/api/teams', { name: 'Open team' })).body;
    await joinTeam(a.c, b.c, team.id);
    expect((await b.c.get(`/api/teams/${team.id}`)).body.myRole).toBe('member');
    expect((await b.c.patch(`/api/teams/${team.id}`, { name: 'Mine now' })).status).toBe(403);
    expect((await b.c.del(`/api/teams/${team.id}`)).status).toBe(403);

    // the creator promotes them, and they can then manage the team
    expect((await a.c.patch(`/api/teams/${team.id}/members/${b.me.id}`, { role: 'admin' })).status).toBe(204);
    expect((await b.c.get(`/api/teams/${team.id}`)).body.myRole).toBe('admin');
    expect((await b.c.patch(`/api/teams/${team.id}/members/${a.me.id}`, { role: 'member' })).status).toBe(204);
    expect((await a.c.get(`/api/teams/${team.id}`)).body.myRole).toBe('member');
    // and remove someone
    expect((await b.c.del(`/api/teams/${team.id}/members/${a.me.id}`)).status).toBe(204);
    const ids = ((await b.c.get(`/api/teams/${team.id}/members`)).body as { user: { id: string } }[]).map(m => m.user.id);
    expect(ids).toEqual([b.me.id]);
  });

  it('keeps a team to the people on it until an invite link lets a guest in, and asks for a name before writing', async () => {
    t = await makeApp({ env: { AUTH_MODE: 'none' } });
    const a = await guest(t.app);
    const b = await guest(t.app);

    const team = (await a.c.post('/api/teams', { name: 'Closed team' })).body;
    const first = (await a.c.post(`/api/teams/${team.id}/current`)).body.boardId as string;
    // another guest neither sees it nor gets in by knowing its id
    expect(((await b.c.get('/api/teams')).body as { id: string }[]).map(x => x.id)).not.toContain(team.id);
    expect((await b.c.get(`/api/teams/${team.id}`)).status).toBe(404);
    expect((await b.c.get(`/api/boards/${first}`)).status).toBe(404);
    expect((await b.c.post(`/api/teams/${team.id}/boards`, { title: 'Sneaky' })).status).toBe(404);
    // and it doesn't join them by trying
    expect(((await a.c.get(`/api/teams/${team.id}/members`)).body as unknown[]).length).toBe(1);

    await joinTeam(a.c, b.c, team.id);
    expect(((await b.c.get('/api/teams')).body as { id: string }[]).map(x => x.id)).toContain(team.id);

    const board = (await b.c.post(`/api/teams/${team.id}/boards`, { title: 'Sprint 1' })).body;
    const state = (await b.c.get(`/api/boards/${board.id}`)).body;
    expect(state.permissions.canFacilitate).toBe(true);
    const columnId = state.columns[0].id;

    const blocked = await b.c.post(`/api/boards/${board.id}/cards`, { columnId, body: 'hello' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/name/);

    const named = (await b.c.patch('/api/auth/me', { name: 'Bo' })).body;
    expect(named).toMatchObject({ name: 'Bo', needsName: false });
    const card = await b.c.post(`/api/boards/${board.id}/cards`, { columnId, body: 'hello' });
    expect(card.status).toBe(200);
    expect(card.body.author.name).toBe('Bo');

    // having joined, the other guest shows up as a possible action owner
    const members = (await a.c.get(`/api/boards/${board.id}`)).body.members.map((m: { id: string }) => m.id);
    expect(members).toEqual(expect.arrayContaining([a.me.id, b.me.id]));
  });

  it('lets someone pick who they are on a team they share, but never take over someone who runs it', async () => {
    t = await makeApp({ env: { AUTH_MODE: 'none' } });
    const lead = await guest(t.app);
    await lead.c.patch('/api/auth/me', { name: 'Lead' });
    const team = (await lead.c.post('/api/teams', { name: 'Crew' })).body;
    const ana = await guest(t.app);
    await ana.c.patch('/api/auth/me', { name: 'Ana' });
    await joinTeam(lead.c, ana.c, team.id);

    // a stranger (on none of Ana's teams) can't be her
    const stranger = await guest(t.app);
    expect((await stranger.c.post('/api/auth/guest/claim', { userId: ana.me.id })).status).toBe(404);

    // A new browser of Ana's, back on the team by its invite link, sees her among its members and says "that's me"
    const other = await guest(t.app);
    await joinTeam(lead.c, other.c, team.id);
    // ...but never the team's admin: picking a name can't hand over the team
    expect((await other.c.post('/api/auth/guest/claim', { userId: lead.me.id })).status).toBe(404);
    const members = (await other.c.get(`/api/teams/${team.id}/members`)).body;
    const anaRow = members.find((m: { user: { name: string } }) => m.user.name === 'Ana');
    expect(anaRow.user.guest).toBe(true);
    const claimed = await other.c.post('/api/auth/guest/claim', { userId: anaRow.user.id });
    expect(claimed.body).toMatchObject({ id: ana.me.id, name: 'Ana', needsName: false });
    expect((await other.c.get('/api/auth/me')).body.id).toBe(ana.me.id);

    // unnamed guests and real accounts can't be claimed
    const nameless = await guest(t.app);
    expect((await other.c.post('/api/auth/guest/claim', { userId: nameless.me.id })).status).toBe(404);

    const fresh = await other.c.post('/api/auth/guest/new');
    expect(fresh.body).toMatchObject({ guest: true, needsName: true });
    expect(fresh.body.id).not.toBe(ana.me.id);
  });

  it('does not offer guest identities in accounts mode', async () => {
    t = await makeApp();
    expect((await new Client(t.app).get('/api/auth/config')).body.mode).toBe('accounts');
    expect((await new Client(t.app).post('/api/auth/guest')).status).toBe(404);
    expect((await new Client(t.app).post('/api/auth/guest/new')).status).toBe(404);
    expect((await new Client(t.app).post('/api/auth/guest/claim', { userId: 'x' })).status).toBe(404);
    const { client } = await signUp(t.app, 'Ada');
    expect((await client.get('/api/auth/me')).body).toMatchObject({ guest: false, needsName: false });
  });
});
