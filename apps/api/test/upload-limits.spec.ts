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
});
