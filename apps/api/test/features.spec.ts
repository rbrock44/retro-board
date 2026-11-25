import { afterEach, describe, expect, it } from 'vitest';
import type { BoardStateDto } from '@retro/shared';
import { Client, makeApp, multipart, teamWithBoard, type TestApp } from './helpers';

let t: TestApp;
afterEach(async () => t?.close());

const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(200, 7)]);

async function upload(app: TestApp['app'], cookie: string, boardId: string) {
  const { payload, contentType } = multipart('file', 'clip.mp4', 'video/mp4', mp4);
  const res = await app.inject({
    method: 'POST', url: `/api/boards/${boardId}/attachments`, payload,
    headers: { cookie, 'x-retro-csrf': '1', 'content-type': contentType },
  });
  return { status: res.statusCode, body: res.json() };
}

describe('features (Admin > Customize > Features)', () => {
  it('are all on by default and listed in the public config', async () => {
    t = await makeApp();
    const cfg = (await new Client(t.app).get('/api/auth/config')).body;
    expect(cfg.site.features).toMatchObject({ videos: true, gifs: true, reactions: true, presence: true });
  });

  it('can start switched off from the launch settings', async () => {
    t = await makeApp({ env: { DISABLED_FEATURES: 'videos, reactions' } });
    const cfg = (await new Client(t.app).get('/api/auth/config')).body;
    expect(cfg.site.features).toMatchObject({ videos: false, reactions: false, images: true });
  });

  it('turning videos off blocks new ones and stops serving old ones', async () => {
    t = await makeApp();
    const { owner, board, state } = await teamWithBoard(t.app);
    const before = await upload(t.app, owner.client.cookie, board.id);
    expect(before.status).toBe(200);
    await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: state.columns[0].id, body: 'demo clip', attachmentIds: [before.body.id] });
    expect((await owner.client.get(`/api/media/${before.body.id}`)).status).toBe(200);

    const saved = await owner.client.patch('/api/admin/settings', { features: { videos: false } });
    expect(saved.body.settings.features).toMatchObject({ videos: false, images: true });
    expect(saved.body.overridden).toContain('features');

    const blocked = await upload(t.app, owner.client.cookie, board.id);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('Video Uploads are turned off on this site');
    expect((await owner.client.get(`/api/media/${before.body.id}`)).status).toBe(404);

    // and back on: the old video is served again
    await owner.client.patch('/api/admin/settings', { reset: ['features'] });
    expect((await owner.client.get(`/api/media/${before.body.id}`)).status).toBe(200);
  });

  it('turning reactions, likes, replies and groups off refuses them', async () => {
    t = await makeApp();
    const { owner, board, state } = await teamWithBoard(t.app);
    const a = (await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: state.columns[0].id, body: 'a' })).body;
    const b = (await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: state.columns[0].id, body: 'b' })).body;
    await owner.client.patch('/api/admin/settings', { features: { reactions: false, likes: false, replies: false, groups: false, carryOver: false, anonymous: false, actions: false } });
    expect((await owner.client.post('/api/reactions', { targetType: 'card', targetId: a.id, emoji: '🎉' })).status).toBe(403);
    expect((await owner.client.post(`/api/cards/${a.id}/vote`)).status).toBe(403);
    expect((await owner.client.post(`/api/cards/${a.id}/replies`, { body: 'hi' })).status).toBe(403);
    expect((await owner.client.post(`/api/cards/${a.id}/group`, { targetId: b.id })).status).toBe(403);
    expect((await owner.client.patch(`/api/cards/${a.id}`, { status: 'carry_over' })).status).toBe(403);
    expect((await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: state.columns[0].id, body: 'c', anonymous: true })).status).toBe(403);
    expect((await owner.client.post(`/api/teams/${board.teamId}/actions`, { title: 'x' })).status).toBe(403);
    // the rest of the board still works
    expect((await owner.client.patch(`/api/cards/${a.id}`, { status: 'discussed' })).status).toBe(200);
    const s = (await owner.client.get(`/api/boards/${board.id}`)).body as BoardStateDto;
    expect(s.cards.find(c => c.id === a.id)?.status).toBe('discussed');
  });

  it('turning export off refuses exports', async () => {
    t = await makeApp();
    const { owner, board } = await teamWithBoard(t.app);
    await owner.client.patch('/api/admin/settings', { features: { export: false } });
    expect((await owner.client.get(`/api/boards/${board.id}/export?format=md`)).status).toBe(403);
    expect((await owner.client.request('POST', '/api/export', { boardIds: [board.id], format: 'md' })).status).toBe(403);
  });
});
