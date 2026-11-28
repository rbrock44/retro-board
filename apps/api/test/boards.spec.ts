import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BoardStateDto, CardDto } from '@retro/shared';
import { positionAfter } from '@retro/shared';
import { addMember, makeApp, signUp, teamWithBoard, type TestApp } from './helpers';

let t: TestApp;
beforeEach(async () => { t = await makeApp(); });
afterEach(async () => t.close());

const state = async (c: { get: (u: string) => Promise<{ body: BoardStateDto }> }, id: string) => (await c.get(`/api/boards/${id}`)).body;

describe('teams and roles', () => {
  it('hides teams from non-members and lets viewers read but not write', async () => {
    const { owner, team, board, state: s } = await teamWithBoard(t.app);
    const outsider = await signUp(t.app, 'Outsider');
    expect((await outsider.client.get(`/api/boards/${board.id}`)).status).toBe(404);
    expect((await outsider.client.get(`/api/teams/${team.id}`)).status).toBe(404);

    const viewer = await addMember(t.app, owner.client, team.id, 'viewer');
    const vs = await state(viewer.client, board.id);
    expect(vs.permissions).toMatchObject({ role: 'viewer', canWrite: false, canVote: false });
    const r = await viewer.client.post(`/api/boards/${board.id}/cards`, { columnId: s.columns[0].id, body: 'hi' });
    expect(r.status).toBe(403);
  });

  it('tells the board which members are viewers, and whether the team leaves them out of picking', async () => {
    const { owner, team, board } = await teamWithBoard(t.app);
    const viewer = await addMember(t.app, owner.client, team.id, 'viewer');
    let s = (await owner.client.get(`/api/boards/${board.id}`)).body as BoardStateDto;
    expect(s.viewerIds).toEqual([viewer.user.id]);
    expect(s.team.pickerSkipsViewers).toBe(false);
    await owner.client.patch(`/api/teams/${team.id}`, { settings: { pickerSkipsViewers: true } });
    s = (await owner.client.get(`/api/boards/${board.id}`)).body as BoardStateDto;
    expect(s.team.pickerSkipsViewers).toBe(true);
    expect((await owner.client.get(`/api/teams/${team.id}`)).body.settings.pickerSkipsViewers).toBe(true);
  });

  it('keeps at least one team admin', async () => {
    const { owner, team } = await teamWithBoard(t.app);
    const r = await owner.client.patch(`/api/teams/${team.id}/members/${owner.user.id}`, { role: 'member' });
    expect(r.status).toBe(400);
    const member = await addMember(t.app, owner.client, team.id, 'member');
    expect((await member.client.patch(`/api/teams/${team.id}/members/${owner.user.id}`, { role: 'viewer' })).status).toBe(403);
  });

  it('expires single-use invites sent to one email', async () => {
    const { owner, team } = await teamWithBoard(t.app);
    const person = await signUp(t.app, 'Pat');
    const inv = (await owner.client.post(`/api/teams/${team.id}/invites`, { email: person.email, role: 'member' })).body;
    expect(inv.maxUses).toBe(1);
    const other = await signUp(t.app, 'Other');
    expect((await other.client.post(`/api/invites/by-token/${inv.token}/accept`)).status).toBe(403);
    expect((await person.client.post(`/api/invites/by-token/${inv.token}/accept`)).status).toBe(200);
    expect((await owner.client.get(`/api/invites/by-token/${inv.token}`)).status).toBe(400);
  });
});

describe('boards, columns and cards', () => {
  it('creates columns from a template', async () => {
    const { state: s } = await teamWithBoard(t.app);
    expect(s.columns.map(c => c.title)).toEqual(['Start', 'Stop', 'Continue']);
    expect(s.permissions.canFacilitate).toBe(true);
  });

  it('supports custom columns and saving them as a team template', async () => {
    const { owner, team } = await teamWithBoard(t.app);
    const b = (await owner.client.post(`/api/teams/${team.id}/boards`, {
      title: 'Custom', columns: [{ title: 'Kudos', color: '#ABCDEF' }, { title: 'Risks', color: '#ff0000' }],
    })).body;
    const s = await state(owner.client, b.id);
    expect(s.columns.map(c => [c.title, c.color])).toEqual([['Kudos', '#abcdef'], ['Risks', '#ff0000']]);

    const added = (await owner.client.post(`/api/boards/${b.id}/columns`, { title: 'Ideas', color: '#00ff00' })).body;
    await owner.client.patch(`/api/columns/${added.id}`, { title: 'Big ideas' });
    await owner.client.post(`/api/boards/${b.id}/save-template`, { name: 'Our retro' });
    const templates = (await owner.client.get(`/api/teams/${team.id}/templates`)).body;
    expect(templates[0]).toMatchObject({ name: 'Our retro', builtIn: false });
    expect(templates[0].columns.map((c: { title: string }) => c.title)).toEqual(['Kudos', 'Risks', 'Big ideas']);
  });

  it('deletes a column with its cards, or moves the cards to another column first', async () => {
    const { owner, board, state: s } = await teamWithBoard(t.app);
    const [start, stop, cont] = s.columns;
    const post = async (columnId: string, body: string) => (await owner.client.post(`/api/boards/${board.id}/cards`, { columnId, body })).body;
    await post(stop.id, 'already here');
    const a = await post(start.id, 'a');
    const b = await post(start.id, 'b');
    const kid = await post(start.id, 'in a group');
    await owner.client.post(`/api/cards/${kid.id}/group`, { targetId: a.id });

    expect((await owner.client.del(`/api/columns/${start.id}?moveTo=${start.id}`)).status).toBe(400);
    expect((await owner.client.del(`/api/columns/${start.id}?moveTo=${stop.id}`)).status).toBe(204);
    let st = await state(owner.client, board.id);
    expect(st.columns.map(c => c.id)).toEqual([stop.id, cont.id]);
    const inStop = st.cards.filter(c => c.columnId === stop.id);
    expect(inStop.filter(c => !c.parentId).sort((x, y) => (x.position < y.position ? -1 : 1)).map(c => c.body)).toEqual(['already here', 'a', 'b']);
    expect(inStop.find(c => c.id === kid.id)?.parentId).toBe(a.id);

    await owner.client.del(`/api/columns/${cont.id}`);
    await post(stop.id, 'x');
    await owner.client.del(`/api/columns/${stop.id}`);
    st = await state(owner.client, board.id);
    expect(st.columns).toEqual([]);
    expect(st.cards).toEqual([]);
    void b;
  });

  it('only lets facilitators change columns', async () => {
    const { owner, team, board, state: s } = await teamWithBoard(t.app);
    const member = await addMember(t.app, owner.client, team.id);
    expect((await member.client.patch(`/api/columns/${s.columns[0].id}`, { title: 'x' })).status).toBe(403);
    expect((await member.client.post(`/api/boards/${board.id}/columns`, { title: 'x', color: '#000000' })).status).toBe(403);
  });

  it('hides anonymous authors from everyone but still lets the author edit', async () => {
    const { owner, team, board, state: s } = await teamWithBoard(t.app);
    const member = await addMember(t.app, owner.client, team.id, 'member', 'Sam');
    const card = (await member.client.post(`/api/boards/${board.id}/cards`, { columnId: s.columns[0].id, body: 'secret', anonymous: true })).body as CardDto;
    expect(card.author).toBeNull();
    expect(card.mine).toBe(true);
    const seenByOwner = (await state(owner.client, board.id)).cards[0];
    expect(seenByOwner.author).toBeNull();
    expect(seenByOwner.mine).toBe(false);
    expect((await member.client.patch(`/api/cards/${card.id}`, { body: 'edited' })).status).toBe(200);
    const other = await addMember(t.app, owner.client, team.id, 'member', 'Kim');
    expect((await other.client.patch(`/api/cards/${card.id}`, { body: 'hijack' })).status).toBe(403);
    // once anonymous, always anonymous: not the author, not an admin
    expect((await member.client.patch(`/api/cards/${card.id}`, { anonymous: false })).status).toBe(400);
    expect((await owner.client.patch(`/api/cards/${card.id}`, { anonymous: false })).status).toBe(400);
    expect((await member.client.patch(`/api/cards/${card.id}`, { body: 'again', anonymous: true })).status).toBe(200);
    expect((await state(owner.client, board.id)).cards[0].author).toBeNull();
  });

  it('moves, groups and ungroups cards', async () => {
    const { owner, board, state: s } = await teamWithBoard(t.app);
    const [c1, c2] = s.columns;
    const a = (await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: c1.id, body: 'A' })).body;
    const b = (await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: c2.id, body: 'B' })).body;
    const c = (await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: c2.id, body: 'C' })).body;

    await owner.client.post(`/api/cards/${a.id}/move`, { columnId: c2.id, position: positionAfter(c.position) });
    let st = await state(owner.client, board.id);
    expect(st.cards.filter(x => x.columnId === c2.id).map(x => x.body)).toEqual(['B', 'C', 'A']);

    // Drop C onto B, then B's group onto A: everything ends up under A.
    await owner.client.post(`/api/cards/${c.id}/group`, { targetId: b.id });
    await owner.client.post(`/api/cards/${b.id}/group`, { targetId: a.id });
    st = await state(owner.client, board.id);
    expect(st.cards.find(x => x.id === b.id)!.parentId).toBe(a.id);
    expect(st.cards.find(x => x.id === c.id)!.parentId).toBe(a.id);

    await owner.client.patch(`/api/cards/${a.id}`, { groupTitle: 'Process' });
    await owner.client.post(`/api/cards/${c.id}/ungroup`);
    st = await state(owner.client, board.id);
    expect(st.cards.find(x => x.id === c.id)!.parentId).toBeNull();
    expect(st.cards.find(x => x.id === a.id)!.groupTitle).toBe('Process');

    await owner.client.del(`/api/cards/${a.id}`);
    st = await state(owner.client, board.id);
    expect(st.cards.find(x => x.id === b.id)!.parentId).toBeNull();
  });

  it('lets each person like a card once, and unlike it', async () => {
    const { owner, team, board, state: s } = await teamWithBoard(t.app);
    const member = await addMember(t.app, owner.client, team.id);
    const x = (await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: s.columns[0].id, body: 'x' })).body;
    const likesOf = async (c: typeof owner.client) => (await state(c, board.id)).cards.find(card => card.id === x.id)!;

    expect((await owner.client.post(`/api/cards/${x.id}/vote`)).status).toBe(200);
    expect((await owner.client.post(`/api/cards/${x.id}/vote`)).status).toBe(200);
    expect(await likesOf(owner.client)).toMatchObject({ likes: 1, liked: true });
    expect(await likesOf(member.client)).toMatchObject({ likes: 1, liked: false });

    await member.client.post(`/api/cards/${x.id}/vote`);
    expect(await likesOf(member.client)).toMatchObject({ likes: 2, liked: true });

    expect((await owner.client.del(`/api/cards/${x.id}/vote`)).status).toBe(200);
    expect((await owner.client.del(`/api/cards/${x.id}/vote`)).status).toBe(200);
    expect(await likesOf(owner.client)).toMatchObject({ likes: 1, liked: false });
  });

  it('locks writing but keeps likes, and closes boards fully', async () => {
    const { owner, team, board, state: s } = await teamWithBoard(t.app);
    const member = await addMember(t.app, owner.client, team.id);
    const card = (await member.client.post(`/api/boards/${board.id}/cards`, { columnId: s.columns[0].id, body: 'x' })).body;
    // locking is a team setting, so only a team admin can do it
    expect((await member.client.patch(`/api/teams/${team.id}`, { settings: { locked: true } })).status).toBe(403);
    await owner.client.patch(`/api/teams/${team.id}`, { settings: { locked: true } });
    expect((await member.client.post(`/api/boards/${board.id}/cards`, { columnId: s.columns[0].id, body: 'y' })).status).toBe(403);
    expect((await member.client.post(`/api/cards/${card.id}/vote`)).status).toBe(200);
    await owner.client.patch(`/api/boards/${board.id}`, { status: 'archived' });
    expect((await member.client.post(`/api/cards/${card.id}/vote`)).status).toBe(403);
    const closed = (await owner.client.get(`/api/teams/${team.id}/boards?status=closed`)).body;
    expect(closed[0]).toMatchObject({ id: board.id, status: 'archived', cardCount: 1 });
    expect(closed[0].closedAt).toBeTruthy();
  });

  it('applies team settings (anonymous, lock, colors) to the open boards, new ones too', async () => {
    const { owner, team, board, state: s } = await teamWithBoard(t.app);
    const other = (await owner.client.post(`/api/teams/${team.id}/boards`, { title: 'Second' })).body;
    const res = await owner.client.patch(`/api/teams/${team.id}`, { settings: { allowAnonymous: false, theme: { accent: '#ffcd00' } } });
    expect(res.body.settings).toMatchObject({ allowAnonymous: false, theme: { accent: '#ffcd00' } });
    for (const id of [board.id, other.id]) {
      const b = (await owner.client.get(`/api/boards/${id}`)).body as BoardStateDto;
      expect(b.board.settings).toMatchObject({ allowAnonymous: false, locked: false });
      expect(b.board.settings.theme?.accent).toBe('#ffcd00');
    }
    expect((await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: s.columns[0].id, body: 'hi', anonymous: true })).status).toBe(403);
    const fresh = (await owner.client.post(`/api/teams/${team.id}/boards`, { title: 'Third' })).body;
    expect(((await owner.client.get(`/api/boards/${fresh.id}`)).body as BoardStateDto).board.settings.allowAnonymous).toBe(false);
    // a board's own update can't change them any more
    await owner.client.patch(`/api/boards/${board.id}`, { settings: { allowAnonymous: true } });
    expect(((await owner.client.get(`/api/boards/${board.id}`)).body as BoardStateDto).board.settings.allowAnonymous).toBe(false);
  });

  it('keeps each board in the history exactly as it was: its own columns, colors and settings', async () => {
    const { owner, team, board } = await teamWithBoard(t.app);
    await owner.client.patch(`/api/teams/${team.id}`, { settings: { allowAnonymous: false, theme: { accent: '#ff0000' } } });
    const archived = (await owner.client.post(`/api/boards/${board.id}/archive`, { name: 'Sprint 1' })).body;
    const current = archived.board.id;
    // the next retro gets different columns and different team settings
    const cols = ((await owner.client.get(`/api/boards/${current}`)).body as BoardStateDto).columns;
    await owner.client.patch(`/api/columns/${cols[0].id}`, { title: 'Wins' });
    await owner.client.post(`/api/boards/${current}/columns`, { title: 'Questions', color: '#3b82f6' });
    await owner.client.patch(`/api/teams/${team.id}`, { settings: { allowAnonymous: true, theme: { accent: '#00ff00' } } });

    const old = (await owner.client.get(`/api/boards/${board.id}`)).body as BoardStateDto;
    const now = (await owner.client.get(`/api/boards/${current}`)).body as BoardStateDto;
    expect(old.columns.map(c => c.title)).toEqual(['Start', 'Stop', 'Continue']);
    expect(now.columns.map(c => c.title)).toEqual(['Wins', 'Stop', 'Continue', 'Questions']);
    expect(old.board.settings).toMatchObject({ allowAnonymous: false });
    expect(old.board.settings.theme?.accent).toBe('#ff0000');
    expect(now.board.settings).toMatchObject({ allowAnonymous: true });
    expect(now.board.settings.theme?.accent).toBe('#00ff00');
  });

  it('takes any single emoji as a reaction, and nothing else', async () => {
    const { owner, board, state: s } = await teamWithBoard(t.app);
    const card = (await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: s.columns[0].id, body: 'x' })).body;
    const react = (emoji: string) => owner.client.post('/api/reactions', { targetType: 'card', targetId: card.id, emoji });
    for (const ok of ['🌮', '👍🏽', '🇺🇸', '👩‍👩‍👧‍👦', '1️⃣', '🫠']) expect((await react(ok)).status, ok).toBe(200);
    for (const bad of ['hello', '👍👍', '<b>', ' 👍', '']) expect((await react(bad)).status, bad).toBe(400);
    const st = (await owner.client.get(`/api/boards/${board.id}`)).body as BoardStateDto;
    expect(st.cards[0].reactions.map(r => r.emoji)).toEqual(expect.arrayContaining(['🌮', '👍🏽', '🇺🇸']));
  });

  it('threads replies one level deep and toggles reactions', async () => {
    const { owner, board, state: s } = await teamWithBoard(t.app);
    const card = (await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: s.columns[0].id, body: 'x' })).body;
    const r1 = (await owner.client.post(`/api/cards/${card.id}/replies`, { body: 'first' })).body;
    const r2 = (await owner.client.post(`/api/cards/${card.id}/replies`, { body: 'nested', parentId: r1.id })).body;
    const r3 = (await owner.client.post(`/api/cards/${card.id}/replies`, { body: 'deeper', parentId: r2.id })).body;
    await owner.client.post('/api/reactions', { targetType: 'card', targetId: card.id, emoji: '🎉' });
    await owner.client.post('/api/reactions', { targetType: 'reply', targetId: r1.id, emoji: '👍' });
    let c = (await state(owner.client, board.id)).cards[0];
    expect(c.replies.map(r => [r.body, r.parentId])).toEqual([['first', null], ['nested', r1.id], ['deeper', r1.id]]);
    expect(c.reactions).toEqual([{ emoji: '🎉', count: 1, mine: true, users: ['Owner'] }]);
    expect(c.replies[0].reactions[0].emoji).toBe('👍');
    await owner.client.post('/api/reactions', { targetType: 'card', targetId: card.id, emoji: '🎉' });
    await owner.client.del(`/api/replies/${r1.id}`);
    c = (await state(owner.client, board.id)).cards[0];
    expect(c.reactions).toEqual([]);
    expect(c.replies).toEqual([]);
    void r3;
  });
});

describe('carry over, actions and history', () => {
  it('carries marked cards into the next board once, and shows open actions there', async () => {
    const { owner, team, board, state: s } = await teamWithBoard(t.app);
    const keep = (await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: s.columns[0].id, body: 'Flaky tests' })).body;
    await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: s.columns[0].id, body: 'Done thing' });
    await owner.client.patch(`/api/cards/${keep.id}`, { status: 'carry_over' });
    const action = (await owner.client.post(`/api/teams/${team.id}/actions`, { title: 'Fix CI', ownerId: owner.user.id, dueDate: '2026-12-01', cardId: keep.id })).body;
    expect(action).toMatchObject({ boardId: board.id, owner: { name: 'Owner' } });
    expect((await owner.client.get(`/api/teams/${team.id}/carry-over`)).body).toEqual({ cards: 1, openActions: 1 });

    await owner.client.patch(`/api/boards/${board.id}`, { status: 'archived' });
    const next = (await owner.client.post(`/api/teams/${team.id}/boards`, { title: 'Sprint 2' })).body;
    const ns = await state(owner.client, next.id);
    expect(ns.columns[0].title).toBe('Carried Over');
    expect(ns.cards).toHaveLength(1);
    expect(ns.cards[0]).toMatchObject({ body: 'Flaky tests', status: 'none', carriedFrom: { cardId: keep.id, boardTitle: 'Sprint 1' } });
    expect(ns.actions.map(a => a.title)).toEqual(['Fix CI']);

    const third = (await owner.client.post(`/api/teams/${team.id}/boards`, { title: 'Sprint 3' })).body;
    expect((await state(owner.client, third.id)).columns[0].title).not.toBe('Carried Over');

    await owner.client.patch(`/api/actions/${action.id}`, { status: 'done' });
    expect((await state(owner.client, third.id)).actions).toEqual([]);
    const done = (await owner.client.get(`/api/teams/${team.id}/actions?status=done`)).body;
    expect(done[0].completedAt).toBeTruthy();
  });

  it('searches cards and actions across the team history', async () => {
    const { owner, team, board, state: s } = await teamWithBoard(t.app);
    await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: s.columns[0].id, body: 'Deploys are 100% slow' });
    await owner.client.post(`/api/teams/${team.id}/actions`, { title: 'Speed up deploys' });
    const r = (await owner.client.get(`/api/teams/${team.id}/search?q=deploy`)).body;
    expect(r.cards[0]).toMatchObject({ board: { title: 'Sprint 1' } });
    expect(r.actions[0].title).toBe('Speed up deploys');
    expect((await owner.client.get(`/api/teams/${team.id}/search?q=100%25`)).body.cards).toHaveLength(1);
  });

  it('exports Markdown and CSV', async () => {
    const { owner, board, state: s } = await teamWithBoard(t.app);
    await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: s.columns[0].id, body: 'Pair more, "really"' });
    const md = await owner.client.get(`/api/boards/${board.id}/export?format=md`);
    expect(md.raw.headers['content-type']).toMatch(/markdown/);
    expect(md.raw.body).toContain('## Start');
    expect(md.raw.body).toContain('- Pair more, "really" — Owner (0 likes)');
    const csv = await owner.client.get(`/api/boards/${board.id}/export?format=csv`);
    expect(csv.raw.body.split('\n')[1]).toBe('"Start","","Pair more, ""really""","Owner","0","Unmarked","0","' + (await state(owner.client, board.id)).cards[0].createdAt + '"');
  });
});

describe('instance admin', () => {
  it('lets admins manage users but never removes the last admin', async () => {
    const admin = await signUp(t.app, 'Admin');
    const user = await signUp(t.app, 'User');
    expect((await user.client.get('/api/admin/users')).status).toBe(403);
    expect((await admin.client.patch(`/api/admin/users/${admin.user.id}`, { role: 'user' })).status).toBe(400);
    await admin.client.patch(`/api/admin/users/${user.user.id}`, { disabled: true });
    expect((await user.client.get('/api/auth/me')).status).toBe(401);
  });
});
