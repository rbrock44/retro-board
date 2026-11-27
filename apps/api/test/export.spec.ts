import { afterEach, describe, expect, it } from 'vitest';
import { addMember, makeApp, signUp, teamWithBoard, type TestApp } from './helpers';

let t: TestApp;
afterEach(async () => t?.close());

describe('export', () => {
  it('puts boards from several teams into one file, grouped by team', async () => {
    t = await makeApp();
    const { owner, team, board, state } = await teamWithBoard(t.app);
    await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: state.columns[0].id, body: 'pair more' });
    const archived = (await owner.client.post(`/api/boards/${board.id}/archive`, { name: 'Sprint 1', date: '2026-11-24' })).body;
    expect(archived.saved.status).toBe('archived');

    const other = (await owner.client.post('/api/teams', { name: 'Design' })).body;
    const b2 = (await owner.client.post(`/api/teams/${other.id}/boards`, { title: 'Kickoff', templateId: 'mad-sad-glad' })).body;

    const md = await owner.client.request('POST', '/api/export', { boardIds: [b2.id, board.id], format: 'md' });
    expect(md.status).toBe(200);
    expect(md.raw.headers['content-disposition']).toMatch(/retro-export-\d{4}-\d{2}-\d{2}\.md/);
    const text = md.raw.body;
    expect(text.indexOf('# Design')).toBeLessThan(text.indexOf(`# ${team.name}`)); // teams in name order
    expect(text).toContain('## 2026-11-24 · Sprint 1');
    expect(text).toContain('pair more');

    const csv = await owner.client.request('POST', '/api/export', { boardIds: [board.id, b2.id], format: 'csv' });
    const first = csv.raw.body.split('\n')[0];
    expect(first).toBe('team,board,column,group,card,author,likes,status,replies,created');
    expect(csv.raw.body).toContain('"2026-11-24 · Sprint 1"');

    // one board on its own reads like the single-board export
    const one = await owner.client.request('POST', '/api/export', { boardIds: [board.id], format: 'md' });
    expect(one.raw.headers['content-disposition']).toContain('2026-11-24-sprint-1.md');
    expect(one.raw.body.startsWith('# 2026-11-24 · Sprint 1')).toBe(true);
  });

  it("won't export boards you can't see", async () => {
    t = await makeApp();
    const { board } = await teamWithBoard(t.app);
    const stranger = await signUp(t.app, 'Stranger');
    expect((await stranger.client.request('POST', '/api/export', { boardIds: [board.id], format: 'md' })).status).toBe(404);
    expect((await stranger.client.request('POST', '/api/export', { boardIds: [], format: 'md' })).status).toBe(400);
  });

  it('is for team admins only, not members or viewers', async () => {
    t = await makeApp();
    const { owner, team, board } = await teamWithBoard(t.app);
    const member = await addMember(t.app, owner.client, team.id, 'member');
    const viewer = await addMember(t.app, owner.client, team.id, 'viewer');
    const admin = await addMember(t.app, owner.client, team.id, 'admin');
    for (const c of [member.client, viewer.client]) {
      expect((await c.request('POST', '/api/export', { boardIds: [board.id], format: 'md' })).status).toBe(403);
      expect((await c.get(`/api/boards/${board.id}/export?format=csv`)).status).toBe(403);
    }
    expect((await admin.client.request('POST', '/api/export', { boardIds: [board.id], format: 'md' })).status).toBe(200);
    expect((await admin.client.get(`/api/boards/${board.id}/export?format=md`)).status).toBe(200);
  });
});
