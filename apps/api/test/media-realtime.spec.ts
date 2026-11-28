import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { io as connect, type Socket } from 'socket.io-client';
import { SOCKET_EVENTS, type BoardEvent } from '@retro/shared';
import { giphySearch, sniffVideo } from '../src/routes/media';
import { addMember, makeApp, multipart, teamWithBoard, type TestApp } from './helpers';

let t: TestApp;
afterEach(async () => t?.close());

async function upload(app: TestApp['app'], cookie: string, boardId: string, name: string, mime: string, data: Buffer) {
  const { payload, contentType } = multipart('file', name, mime, data);
  const res = await app.inject({
    method: 'POST', url: `/api/boards/${boardId}/attachments`, payload,
    headers: { cookie, 'x-retro-csrf': '1', 'content-type': contentType },
  });
  return { status: res.statusCode, body: res.json() };
}

describe('media', () => {
  it('stores images without metadata, makes thumbnails, and attaches them to cards', async () => {
    t = await makeApp();
    const { owner, board, state } = await teamWithBoard(t.app);
    const png = await sharp({ create: { width: 1200, height: 600, channels: 3, background: '#3366ff' } }).png().toBuffer();
    const up = await upload(t.app, owner.client.cookie, board.id, 'wide.png', 'image/png', png);
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ kind: 'image', mime: 'image/png', width: 1200, height: 600 });
    expect(up.body.thumbUrl).toMatch(/\/thumb$/);

    const card = (await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: state.columns[0].id, body: '', attachmentIds: [up.body.id] })).body;
    expect(card.attachments).toHaveLength(1);
    // A file can only be attached once.
    expect((await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: state.columns[0].id, body: 'x', attachmentIds: [up.body.id] })).status).toBe(400);

    const file = await owner.client.get(up.body.url);
    expect(file.status).toBe(200);
    expect(file.raw.headers['content-type']).toBe('image/png');
    expect(file.raw.headers['x-content-type-options']).toBe('nosniff');
    const thumb = await sharp(file.raw.rawPayload).metadata();
    expect(thumb.width).toBe(1200);
    const small = await sharp((await owner.client.get(up.body.thumbUrl)).raw.rawPayload).metadata();
    expect(small).toMatchObject({ format: 'webp', width: 800 });
  });

  it('keeps animated gifs as gifs and serves byte ranges for video', async () => {
    t = await makeApp();
    const { owner, board } = await teamWithBoard(t.app);
    const gif = await sharp({ create: { width: 20, height: 10, channels: 4, background: '#ff0000' } }).gif().toBuffer();
    const g = await upload(t.app, owner.client.cookie, board.id, 'a.gif', 'image/gif', gif);
    expect(g.body).toMatchObject({ kind: 'gif', mime: 'image/gif' });

    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(200, 7)]);
    const v = await upload(t.app, owner.client.cookie, board.id, 'clip.mp4', 'video/mp4', mp4);
    expect(v.body).toMatchObject({ kind: 'video', mime: 'video/mp4' });
    const part = await owner.client.request('GET', v.body.url, undefined, { range: 'bytes=4-11' });
    expect(part.status).toBe(206);
    expect(part.raw.headers['content-range']).toBe(`bytes 4-11/${mp4.length}`);
    expect(part.raw.body).toBe('ftypisom');
  });

  it('rejects files that are not images or video, whatever they claim to be', async () => {
    t = await makeApp();
    const { owner, board } = await teamWithBoard(t.app);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await upload(t.app, owner.client.cookie, board.id, 'x.png', 'image/png', svg)).status).toBe(400);
    expect((await upload(t.app, owner.client.cookie, board.id, 'x.txt', 'text/plain', Buffer.from('hello'))).status).toBe(400);
  });

  it('only embeds GIFs from Tenor or Giphy', async () => {
    t = await makeApp();
    const { owner, board } = await teamWithBoard(t.app);
    expect((await owner.client.post(`/api/boards/${board.id}/attachments/gif`, { url: 'https://evil.example/x.gif' })).status).toBe(400);
    const ok = await owner.client.post(`/api/boards/${board.id}/attachments/gif`, { url: 'https://media.tenor.com/abc/x.gif' });
    expect(ok.body).toMatchObject({ kind: 'gif', url: 'https://media.tenor.com/abc/x.gif' });
  });

  it('searches Giphy (trending when empty) and maps results to GIFs that can be embedded', async () => {
    const urls: URL[] = [];
    const fake = (async (u: URL) => {
      urls.push(u);
      return new Response(JSON.stringify({ data: [
        { id: 'a1', title: 'Party', images: {
          original: { url: 'https://media2.giphy.com/media/a1/giphy.gif?cid=x', width: '480', height: '270' },
          fixed_width: { url: 'https://media2.giphy.com/media/a1/200w.gif?cid=x', width: '200', height: '113' } } },
        { id: 'b2', title: 'No original', images: {} },
      ] }));
    }) as unknown as typeof fetch;
    const found = await giphySearch('k', 'party', fake);
    expect(found).toEqual([{ id: 'a1', title: 'Party', url: 'https://media2.giphy.com/media/a1/giphy.gif?cid=x',
      previewUrl: 'https://media2.giphy.com/media/a1/200w.gif?cid=x', width: 480, height: 270 }]);
    expect(urls[0].pathname).toBe('/v1/gifs/search');
    expect(urls[0].searchParams.get('q')).toBe('party');
    expect(urls[0].searchParams.get('rating')).toBe('pg-13');
    await giphySearch('k', '', fake);
    expect(urls[1].pathname).toBe('/v1/gifs/trending');

    // and the result embeds
    t = await makeApp();
    const { owner, board } = await teamWithBoard(t.app);
    const a = await owner.client.post(`/api/boards/${board.id}/attachments/gif`, { url: found[0].url, previewUrl: found[0].previewUrl, width: 480, height: 270 });
    expect(a.body).toMatchObject({ kind: 'gif', url: found[0].url });
  });

  it('sniffs video containers by magic bytes', () => {
    expect(sniffVideo(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypqt  '), Buffer.alloc(4)]))?.mime).toBe('video/quicktime');
    expect(sniffVideo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]))?.mime).toBe('video/webm');
    expect(sniffVideo(Buffer.from('hello world!!'))).toBeNull();
  });
});

describe('realtime', () => {
  it('pushes card changes to everyone on the board, shaped for each viewer', async () => {
    t = await makeApp({ realtime: true });
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = t.app.server.address() as { port: number };
    const { owner, team, board, state } = await teamWithBoard(t.app);
    const member = await addMember(t.app, owner.client, team.id, 'member', 'Sam');

    const open = (cookie: string) => new Promise<Socket>((resolve, reject) => {
      const s = connect(`http://127.0.0.1:${port}`, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie } });
      s.on('connect', () => s.emit(SOCKET_EVENTS.join, board.id, (r: { ok: boolean }) => (r.ok ? resolve(s) : reject(new Error('join')))));
      s.on('connect_error', reject);
    });
    const a = await open(owner.client.cookie);
    const b = await open(member.client.cookie);
    const next = (s: Socket, type: BoardEvent['type']) => new Promise<BoardEvent>(resolve => {
      const h = (e: BoardEvent) => { if (e.type === type) { s.off(SOCKET_EVENTS.event, h); resolve(e); } };
      s.on(SOCKET_EVENTS.event, h);
    });

    const presence = await next(a, 'presence');
    expect(presence.type === 'presence' && presence.users.length).toBeGreaterThanOrEqual(1);

    const forA = next(a, 'card.upsert');
    const forB = next(b, 'card.upsert');
    await member.client.post(`/api/boards/${board.id}/cards`, { columnId: state.columns[0].id, body: 'live!', anonymous: true });
    const [ea, eb] = await Promise.all([forA, forB]);
    expect(ea.type === 'card.upsert' && ea.card).toMatchObject({ body: 'live!', mine: false, author: null });
    expect(eb.type === 'card.upsert' && eb.card).toMatchObject({ body: 'live!', mine: true });

    const rejected = connect(`http://127.0.0.1:${port}`, { path: '/socket.io', transports: ['websocket'] });
    await expect(new Promise((_, reject) => rejected.on('connect_error', reject))).rejects.toThrow(/unauthorized/);
    for (const s of [a, b, rejected]) s.close();
  });

  it('marks viewers in the presence list as watching', async () => {
    t = await makeApp({ realtime: true });
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = t.app.server.address() as { port: number };
    const { owner, team, board } = await teamWithBoard(t.app);
    const viewer = await addMember(t.app, owner.client, team.id, 'viewer', 'Vic');

    const sockets: Socket[] = [];
    const open = (cookie: string) => new Promise<Socket>((resolve, reject) => {
      const s = connect(`http://127.0.0.1:${port}`, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie } });
      sockets.push(s);
      s.on('connect', () => s.emit(SOCKET_EVENTS.join, board.id, (r: { ok: boolean }) => (r.ok ? resolve(s) : reject(new Error('join')))));
      s.on('connect_error', reject);
    });
    try {
      const mine = await open(owner.client.cookie);
      const both = new Promise<BoardEvent>(resolve => mine.on(SOCKET_EVENTS.event, (e: BoardEvent) => {
        if (e.type === 'presence' && e.users.length === 2) resolve(e);
      }));
      await open(viewer.client.cookie);
      const e = await both;
      expect(e.type === 'presence' && e.watching).toEqual([viewer.user.id]);

      // made a member: no longer only watching
      const after = new Promise<BoardEvent>(resolve => mine.on(SOCKET_EVENTS.event, (ev: BoardEvent) => {
        if (ev.type === 'presence' && ev.users.length === 2 && !ev.watching?.length) resolve(ev);
      }));
      await owner.client.patch(`/api/teams/${team.id}/members/${viewer.user.id}`, { role: 'member' });
      await after;
    } finally {
      for (const s of sockets) s.close();
    }
  });

  it('stops live changes for someone who loses access while connected', async () => {
    t = await makeApp({ realtime: true });
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = t.app.server.address() as { port: number };
    const { owner, team, board, state } = await teamWithBoard(t.app);
    const sam = await addMember(t.app, owner.client, team.id, 'member', 'Sam');
    const kim = await addMember(t.app, owner.client, team.id, 'member', 'Kim');

    const sockets: Socket[] = [];
    const open = (cookie: string) => new Promise<Socket>((resolve, reject) => {
      const s = connect(`http://127.0.0.1:${port}`, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie } });
      sockets.push(s); // closed at the end even when turned away
      s.on('connect', () => s.emit(SOCKET_EVENTS.join, board.id, (r: { ok: boolean }) => (r.ok ? resolve(s) : reject(new Error('join')))));
      s.on('connect_error', reject);
    });
    const events = (s: Socket) => { const got: BoardEvent[] = []; s.on(SOCKET_EVENTS.event, (e: BoardEvent) => got.push(e)); return got; };
    const settle = () => new Promise(r => setTimeout(r, 300));
    try {
      const samSock = await open(sam.client.cookie), kimSock = await open(kim.client.cookie);
      await open(owner.client.cookie);
      const samGot = events(samSock), kimGot = events(kimSock);

      // Sam is removed from the team: told, and gets nothing after that
      await owner.client.del(`/api/teams/${team.id}/members/${sam.user.id}`);
      await settle();
      expect(samGot.some(e => e.type === 'access.lost' && e.boardId === board.id)).toBe(true);
      await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: state.columns[0].id, body: 'after removal' });
      await settle();
      expect(samGot.some(e => e.type === 'card.upsert')).toBe(false);
      expect(kimGot.some(e => e.type === 'card.upsert')).toBe(true);

      // a new team password: Kim hasn't typed it, so she's out. Every connection made before it is told (their
      // cookies are from before), and the browser reconnects with its current ones: the owner's gets back in.
      await owner.client.put(`/api/teams/${team.id}/password`, { password: 'sprint' });
      await settle();
      expect(kimGot.some(e => e.type === 'access.lost')).toBe(true);
      await expect(open(kim.client.cookie)).rejects.toThrow('join');
      await expect(open(owner.client.cookie)).resolves.toBeTruthy();
    } finally {
      for (const s of sockets) s.close();
    }
  });
});
