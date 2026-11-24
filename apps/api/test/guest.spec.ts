import { afterEach, describe, expect, it } from 'vitest';
import { Client, makeApp, signUp, type TestApp } from './helpers';

let t: TestApp;
afterEach(async () => t?.close());

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

  it('lets guests do everything, but asks for a name before writing', async () => {
    t = await makeApp({ env: { AUTH_MODE: 'none' } });
    const a = await guest(t.app);
    const b = await guest(t.app);

    const team = (await a.c.post('/api/teams', { name: 'Open team' })).body;
    // another guest sees every team without being invited
    const list = (await b.c.get('/api/teams')).body;
    expect(list.map((x: { id: string }) => x.id)).toContain(team.id);

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

    // the other guest joins the team by visiting, so shows up as a possible action owner
    const members = (await a.c.get(`/api/boards/${board.id}`)).body.members.map((m: { id: string }) => m.id);
    expect(members).toEqual(expect.arrayContaining([a.me.id, b.me.id]));
  });

  it('does not offer guest identities in accounts mode', async () => {
    t = await makeApp();
    expect((await new Client(t.app).get('/api/auth/config')).body.mode).toBe('accounts');
    expect((await new Client(t.app).post('/api/auth/guest')).status).toBe(404);
    const { client } = await signUp(t.app, 'Ada');
    expect((await client.get('/api/auth/me')).body).toMatchObject({ guest: false, needsName: false });
  });
});
