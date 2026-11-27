import { gunzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { BoardStateDto } from '@retro/shared';
import { MANIFEST } from '../src/lib/backup';
import { tarStream, untar } from '../src/lib/tar';
import { Client, addMember, makeApp, multipart, signUp, teamWithBoard, type TestApp } from './helpers';

let t: TestApp;
let t2: TestApp | undefined;
afterEach(async () => { await t?.close(); await t2?.close(); t2 = undefined; });

async function post(app: TestApp['app'], cookie: string, url: string, name: string, data: Buffer, mime = 'application/gzip') {
  const { payload, contentType } = multipart('file', name, mime, data);
  const res = await app.inject({ method: 'POST', url, payload, headers: { cookie, 'x-retro-csrf': '1', 'content-type': contentType } });
  return { status: res.statusCode, body: res.json() };
}

async function entries(gz: Buffer) {
  const names: string[] = [];
  for await (const e of untar(Readable.from([gunzipSync(gz)]))) names.push(e.name);
  return names;
}

describe('backup and restore in the app', () => {
  it('downloads everything as one file and restores it into another instance, uploads included', async () => {
    t = await makeApp();
    const { owner, team, board, state } = await teamWithBoard(t.app);
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const up = await post(t.app, owner.client.cookie, `/api/boards/${board.id}/attachments`, 'red.png', png, 'image/png');
    await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: state.columns[0].id, body: 'keep me', attachmentIds: [up.body.id] });

    const res = await owner.client.get('/api/admin/backup');
    expect(res.status).toBe(200);
    expect(res.raw.headers['content-disposition']).toMatch(/attachment; filename="retro-board-.*\.tar\.gz"/);
    const file = res.raw.rawPayload;
    const names = await entries(file);
    expect(names[0]).toBe(MANIFEST);
    const fileCount = names.filter(n => n.startsWith('files/')).length;
    expect(fileCount).toBeGreaterThan(0);

    // a brand new instance with its own first admin, then the restore replaces it all
    t2 = await makeApp();
    const other = await signUp(t2.app, 'Someone Else');
    const r = await post(t2.app, other.client.cookie, '/api/admin/restore', 'backup.tar.gz', file);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ files: fileCount });
    // sessions aren't in backups: the restorer is signed out
    expect((await other.client.get('/api/auth/me')).status).toBe(401);

    const login = new Client(t2.app);
    const signin = await login.post('/api/auth/login', { email: owner.email, password: 'correct horse battery' });
    expect(signin.status).toBe(200);
    const s = (await login.get(`/api/boards/${board.id}`)).body as BoardStateDto;
    expect(s.cards[0]).toMatchObject({ body: 'keep me' });
    const img = await login.get(s.cards[0].attachments[0].url);
    expect(img.status).toBe(200);
    expect((await sharp(img.raw.rawPayload).metadata()).width).toBe(64);
    expect((await login.get(`/api/teams/${team.id}`)).status).toBe(200);
  });

  it('only lets instance admins back up or restore, and refuses files that are not backups', async () => {
    t = await makeApp();
    const { owner, team } = await teamWithBoard(t.app);
    const member = await addMember(t.app, owner.client, team.id, 'admin');
    expect((await member.client.get('/api/admin/backup')).status).toBe(403);
    expect((await post(t.app, member.client.cookie, '/api/admin/restore', 'b.tar.gz', Buffer.from('x'))).status).toBe(403);
    const bad = await post(t.app, owner.client.cookie, '/api/admin/restore', 'b.tar.gz', Buffer.from('not a backup'));
    expect(bad.status).toBe(400);
    // nothing was touched
    expect((await owner.client.get(`/api/teams/${team.id}`)).status).toBe(200);
  });

  it('reads back what it writes: big files across chunks, long paths, odd sizes', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024 + 7, 0).map((_, i) => i % 251);
    const files = [
      { name: 'a.json', data: Buffer.from('{}') },
      { name: `files/board/${'x'.repeat(60)}/${'y'.repeat(70)}.png`, data: big },
      { name: 'empty', data: Buffer.alloc(0) },
    ];
    async function* gen() { yield* files; }
    const parts: Buffer[] = [];
    for await (const p of tarStream(gen())) parts.push(p);
    const tar = Buffer.concat(parts);
    // feed it back in small uneven chunks, like a network stream
    const chunks: Buffer[] = [];
    for (let i = 0; i < tar.length; i += 7777) chunks.push(tar.subarray(i, i + 7777));
    const out: { name: string; data: Buffer }[] = [];
    for await (const e of untar(Readable.from(chunks))) out.push(e);
    expect(out.map(e => e.name)).toEqual(files.map(f => f.name));
    expect(out[1].data.equals(big)).toBe(true);
    expect(out[2].data.length).toBe(0);
  });
});
