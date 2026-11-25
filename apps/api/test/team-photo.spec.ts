import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { addMember, makeApp, multipart, signUp, teamWithBoard, type TestApp } from './helpers';

let t: TestApp;
afterEach(async () => t?.close());

async function upload(app: TestApp['app'], cookie: string, teamId: string, mime: string, data: Buffer) {
  const { payload, contentType } = multipart('file', 'photo', mime, data);
  const res = await app.inject({
    method: 'POST', url: `/api/teams/${teamId}/photo`, payload,
    headers: { cookie, 'x-retro-csrf': '1', 'content-type': contentType },
  });
  return { status: res.statusCode, body: res.json() };
}

describe('team photo', () => {
  it('stores a square webp, shows it to members only, and replaces or removes it', async () => {
    t = await makeApp();
    const { owner, team, board } = await teamWithBoard(t.app);
    expect(team.photoUrl).toBeNull();
    const png = await sharp({ create: { width: 900, height: 400, channels: 3, background: '#22aa66' } }).png().toBuffer();

    const up = await upload(t.app, owner.client.cookie, team.id, 'image/png', png);
    expect(up.status).toBe(200);
    expect(up.body.photoUrl).toMatch(new RegExp(`^/api/teams/${team.id}/photo\\?v=`));
    expect((await owner.client.get(`/api/teams/${team.id}`)).body.photoUrl).toBe(up.body.photoUrl);
    expect((await owner.client.get(`/api/boards/${board.id}`)).body.team.photoUrl).toBe(up.body.photoUrl);

    const file = await owner.client.get(up.body.photoUrl);
    expect(file.status).toBe(200);
    expect(file.raw.headers['content-type']).toBe('image/webp');
    expect(await sharp(file.raw.rawPayload).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 });

    // Members see it but can't change it; outsiders get a 404
    const member = await addMember(t.app, owner.client, team.id, 'member');
    expect((await member.client.get(up.body.photoUrl)).status).toBe(200);
    expect((await upload(t.app, member.client.cookie, team.id, 'image/png', png)).status).toBe(403);
    expect((await member.client.del(`/api/teams/${team.id}/photo`)).status).toBe(403);
    const outsider = await signUp(t.app, 'Outsider');
    expect((await outsider.client.get(up.body.photoUrl)).status).toBe(404);

    // Not an image
    expect((await upload(t.app, owner.client.cookie, team.id, 'image/png', Buffer.from('not really a png'))).status).toBe(400);

    // A new photo gets a new URL
    const again = await upload(t.app, owner.client.cookie, team.id, 'image/png', png);
    expect(again.body.photoUrl).not.toBe(up.body.photoUrl);

    const removed = await owner.client.del(`/api/teams/${team.id}/photo`);
    expect(removed.status).toBe(200);
    expect(removed.body.photoUrl).toBeNull();
    expect((await owner.client.get(`/api/teams/${team.id}/photo`)).status).toBe(404);
  });
});
