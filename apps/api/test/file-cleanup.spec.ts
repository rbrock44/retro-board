import { existsSync } from 'node:fs';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { attachments } from '../src/db/schema';
import { sweepFiles } from '../src/lib/file-cleanup';
import { makeApp, multipart, teamWithBoard, type TestApp } from './helpers';

let t: TestApp;
afterEach(async () => t?.close());

async function upload(cookie: string, boardId: string) {
  const png = await sharp({ create: { width: 1200, height: 600, channels: 3, background: '#3366ff' } }).png().toBuffer();
  const { payload, contentType } = multipart('file', 'wide.png', 'image/png', png);
  const res = await t.app.inject({
    method: 'POST', url: `/api/boards/${boardId}/attachments`, payload,
    headers: { cookie, 'x-retro-csrf': '1', 'content-type': contentType },
  });
  const [row] = await t.ctx.db.select().from(attachments).where(eq(attachments.id, res.json().id));
  return { id: row.id, files: [row.storageKey!, row.thumbKey!].map(k => join(t.uploads, k)) };
}

describe('file cleanup', () => {
  it('removes a card\'s files with the card, and a board\'s and team\'s with them', async () => {
    t = await makeApp();
    const { owner, team, board, state } = await teamWithBoard(t.app);
    const col = state.columns[0].id;
    const onCard = await upload(owner.client.cookie, board.id);
    expect(onCard.files.every(f => existsSync(f))).toBe(true);
    const card = (await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: col, body: 'x', attachmentIds: [onCard.id] })).body;
    await owner.client.del(`/api/cards/${card.id}`);
    expect(onCard.files.some(f => existsSync(f))).toBe(false);

    const onBoard = await upload(owner.client.cookie, board.id);
    await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: col, body: 'y', attachmentIds: [onBoard.id] });
    await owner.client.del(`/api/teams/${team.id}`);
    expect(onBoard.files.some(f => existsSync(f))).toBe(false);
  });

  it('sweeps up uploads never used and files nothing points at, but not new or used ones', async () => {
    t = await makeApp();
    const { owner, board, state } = await teamWithBoard(t.app);
    const used = await upload(owner.client.cookie, board.id);
    await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: state.columns[0].id, body: 'x', attachmentIds: [used.id] });
    const abandoned = await upload(owner.client.cookie, board.id);
    const fresh = await upload(owner.client.cookie, board.id); // still being written up
    await t.ctx.db.update(attachments).set({ createdAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(attachments.id, abandoned.id));

    const stray = join(t.uploads, 'boards', 'gone-board', 'old.png');
    const recentStray = join(t.uploads, 'boards', 'gone-board', 'new.png');
    const elsewhere = join(t.uploads, 'not-ours', 'keep.txt');
    for (const f of [stray, recentStray, elsewhere]) { await mkdir(dirname(f), { recursive: true }); await writeFile(f, 'x'); }
    const old = new Date(Date.now() - 3 * 3600_000);
    for (const f of [stray, elsewhere, ...used.files]) await utimes(f, old, old);

    await sweepFiles(t.ctx);
    expect(used.files.every(f => existsSync(f))).toBe(true);
    expect(abandoned.files.some(f => existsSync(f))).toBe(false);
    expect(fresh.files.every(f => existsSync(f))).toBe(true);
    expect(existsSync(stray)).toBe(false);
    expect(existsSync(recentStray)).toBe(true);
    expect(existsSync(elsewhere)).toBe(true);
  });
});
