import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { Client, makeApp, multipart, teamWithBoard, type TestApp } from './helpers';

let t: TestApp;
afterEach(async () => t?.close());

const MB = 1024 * 1024;
/** A video of about `mb` MB (the type is read from its first bytes) */
const video = (mb: number) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(Math.round(mb * MB), 7)]);
/** A PNG of about `mb` MB (random pixels don't compress) */
const image = async (mb: number) => {
  const side = Math.ceil(Math.sqrt((mb * MB) / 3));
  return sharp(Buffer.from(Array.from({ length: side * side * 3 }, () => Math.floor(Math.random() * 256))), { raw: { width: side, height: side, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
};

async function upload(cookie: string, boardId: string, name: string, mime: string, data: Buffer) {
  const { payload, contentType } = multipart('file', name, mime, data);
  const res = await t.app.inject({
    method: 'POST', url: `/api/boards/${boardId}/attachments`, payload,
    headers: { cookie, 'x-retro-csrf': '1', 'content-type': contentType },
  });
  return { status: res.statusCode, body: res.json() };
}

describe('upload size limits (Admin > Customize > Features)', () => {
  it('start from MAX_UPLOAD_MB, and admins set images and videos apart', async () => {
    t = await makeApp({ env: { MAX_UPLOAD_MB: '3' } });
    expect((await new Client(t.app).get('/api/auth/config')).body.site).toMatchObject({ maxImageMb: 3, maxVideoMb: 3 });
    const { owner, board } = await teamWithBoard(t.app);
    expect((await upload(owner.client.cookie, board.id, 'big.mp4', 'video/mp4', video(4))).status).toBe(413);

    const saved = await owner.client.patch('/api/admin/settings', { maxVideoMb: 5, maxImageMb: 1 });
    expect(saved.body.settings).toMatchObject({ maxVideoMb: 5, maxImageMb: 1 });
    expect(saved.body.overridden).toEqual(expect.arrayContaining(['maxVideoMb', 'maxImageMb']));

    expect((await upload(owner.client.cookie, board.id, 'ok.mp4', 'video/mp4', video(4))).status).toBe(200);
    const tooBig = await upload(owner.client.cookie, board.id, 'big.png', 'image/png', await image(1.5));
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error).toBe('Images can be at most 1 MB');

    expect((await owner.client.patch('/api/admin/settings', { maxVideoMb: 0 })).status).toBe(400);
    await owner.client.patch('/api/admin/settings', { reset: ['maxVideoMb'] });
    expect((await new Client(t.app).get('/api/auth/config')).body.site.maxVideoMb).toBe(3);
  });

  it('shows what uploads use, and refuses new ones once the room for them is full', async () => {
    t = await makeApp();
    const { owner, board, state } = await teamWithBoard(t.app);
    const first = await upload(owner.client.cookie, board.id, 'a.mp4', 'video/mp4', video(0.001));
    expect(first.status).toBe(200);
    // counted once it's on a card too
    await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: state.columns[0].id, body: 'x', attachmentIds: [first.body.id] });
    const used = (await owner.client.get('/api/admin/settings')).body.storage.used;
    expect(used).toEqual({ bytes: first.body.size, files: 1 });

    // room for about one and a half of these
    await owner.client.patch('/api/admin/settings', { maxStorageGb: (first.body.size * 1.5) / 1024 ** 3 });
    expect((await owner.client.get('/api/auth/config')).body.site.uploadsFull).toBe(false);
    const full = await upload(owner.client.cookie, board.id, 'b.mp4', 'video/mp4', video(0.001));
    expect(full.status).toBe(507);
    expect(full.body.error).toMatch(/room for uploads .* is full/);
    // used up: the app turns attaching off and says why
    await owner.client.patch('/api/admin/settings', { maxStorageGb: first.body.size / 1024 ** 3 });
    expect((await owner.client.get('/api/auth/config')).body.site.uploadsFull).toBe(true);

    await owner.client.patch('/api/admin/settings', { maxStorageGb: null });
    expect((await owner.client.get('/api/auth/config')).body.site.uploadsFull).toBe(false);
    expect((await upload(owner.client.cookie, board.id, 'b.mp4', 'video/mp4', video(0.001))).status).toBe(200);
  });
});
