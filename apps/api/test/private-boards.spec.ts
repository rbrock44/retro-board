import { afterEach, describe, expect, it } from 'vitest';
import type { BoardDto, BoardStateDto } from '@retro/shared';
import { addMember, makeApp, signUp, teamWithBoard, type TestApp } from './helpers';

let t: TestApp;
afterEach(async () => t?.close());

async function privateBoard(password?: string) {
  const base = await teamWithBoard(t.app);
  const { owner, team } = base;
  const res = await owner.client.post(`/api/teams/${team.id}/boards`, { title: 'Leadership retro', private: true, ...(password ? { password } : {}) });
  expect(res.status).toBe(200);
  const board = res.body as BoardDto;
  const state = (await owner.client.get(`/api/boards/${board.id}`)).body as BoardStateDto;
  return { ...base, secret: board, link: state.privateLink! };
}

describe('private boards', () => {
  it('are hidden from the team, but listed for their creator and team admins', async () => {
    t = await makeApp();
    const { owner, team, board: current, secret, link } = await privateBoard();
    expect(secret).toMatchObject({ private: true, hasPassword: false });
    expect(link).toMatch(/^[\w-]{20,}$/);
    const member = await addMember(t.app, owner.client, team.id, 'member');
    const admin = await addMember(t.app, owner.client, team.id, 'admin');
    await owner.client.post(`/api/boards/${secret.id}/cards`, { columnId: (await owner.client.get(`/api/boards/${secret.id}`)).body.columns[0].id, body: 'quiet worry' });

    const ids = async (c: typeof owner.client) => ((await c.get(`/api/teams/${team.id}/boards`)).body as BoardDto[]).map(b => b.id);
    expect(await ids(member.client)).not.toContain(secret.id);
    expect(await ids(owner.client)).toContain(secret.id);
    expect(await ids(admin.client)).toContain(secret.id);
    expect((await member.client.get(`/api/boards/${secret.id}`)).status).toBe(404);
    expect((await member.client.get(`/api/teams/${team.id}/search?q=quiet`)).body.cards).toHaveLength(0);
    expect((await owner.client.get(`/api/teams/${team.id}/search?q=quiet`)).body.cards).toHaveLength(1);
    // never the team's current board, and only facilitators get the link
    expect((await member.client.post(`/api/teams/${team.id}/current`)).body.boardId).toBe(current.id);
    expect((await admin.client.get(`/api/boards/${secret.id}`)).body.privateLink).toBe(link);
  });

  it('open by their link for anyone, even off the team, without showing them the team', async () => {
    t = await makeApp();
    const { owner, team, secret, link } = await privateBoard();
    await addMember(t.app, owner.client, team.id, 'member', 'Teammate');
    await owner.client.put(`/api/teams/${team.id}/password`, { password: 'team-pass' });
    const guest = await signUp(t.app, 'Visitor');

    expect((await guest.client.get(`/api/boards/${secret.id}`)).status).toBe(404);
    expect((await guest.client.post('/api/private/not-a-real-link-code')).status).toBe(404);
    expect((await guest.client.post(`/api/private/${link}`)).body).toEqual({ boardId: secret.id });

    // the link stands in for the team's password; the team itself stays closed
    const state = (await guest.client.get(`/api/boards/${secret.id}`)).body as BoardStateDto;
    expect(state.permissions.canWrite).toBe(true);
    expect(state.privateLink).toBeNull();
    expect(state.members.map(m => m.name).sort()).toEqual(['Owner', 'Visitor']);
    expect((await guest.client.post(`/api/boards/${secret.id}/cards`, { columnId: state.columns[0].id, body: 'from outside' })).status).toBe(200);
    expect((await guest.client.get(`/api/teams/${team.id}`)).status).toBe(404);

    // its action items stay on it, and the people on it can own them
    const act = await guest.client.post(`/api/teams/${team.id}/actions`, { title: 'private follow-up', boardId: secret.id, ownerId: guest.user.id });
    expect(act.status).toBe(200);
    expect(((await owner.client.get(`/api/teams/${team.id}/actions`)).body as { title: string }[]).map(a => a.title)).not.toContain('private follow-up');
    expect((await guest.client.get(`/api/boards/${secret.id}`)).body.actions.map((a: { title: string }) => a.title)).toEqual(['private follow-up']);
  });

  it('can have their own password, which everyone but the creator types once', async () => {
    t = await makeApp();
    const { owner, secret, link } = await privateBoard('hush');
    expect(secret.hasPassword).toBe(true);
    expect((await owner.client.get(`/api/boards/${secret.id}`)).status).toBe(200);

    const guest = await signUp(t.app, 'Visitor');
    await guest.client.post(`/api/private/${link}`);
    const locked = await guest.client.get(`/api/boards/${secret.id}`);
    expect(locked.status).toBe(423);
    expect(locked.body).toMatchObject({ lockedBoard: { id: secret.id, name: 'Leadership retro' } });
    expect((await guest.client.post(`/api/boards/${secret.id}/unlock`, { password: 'nope' })).status).toBe(400);
    expect((await guest.client.post(`/api/boards/${secret.id}/unlock`, { password: 'hush' })).status).toBe(200);
    expect((await guest.client.get(`/api/boards/${secret.id}`)).status).toBe(200);

    // someone without the link can't even try
    const stranger = await signUp(t.app, 'Stranger');
    expect((await stranger.client.post(`/api/boards/${secret.id}/unlock`, { password: 'hush' })).status).toBe(404);

    // a new password: asked again
    await owner.client.put(`/api/boards/${secret.id}/password`, { password: 'quiet' });
    expect((await guest.client.get(`/api/boards/${secret.id}`)).status).toBe(423);
    await owner.client.put(`/api/boards/${secret.id}/password`, { password: null });
    expect((await guest.client.get(`/api/boards/${secret.id}`)).status).toBe(200);
  });

  it('cut off everyone who came by the old link when it is replaced or the board stops being private', async () => {
    t = await makeApp();
    const { owner, secret, link } = await privateBoard();
    const guest = await signUp(t.app, 'Visitor');
    await guest.client.post(`/api/private/${link}`);
    expect((await guest.client.get(`/api/boards/${secret.id}`)).status).toBe(200);

    const fresh = (await owner.client.post(`/api/boards/${secret.id}/private/new-link`)).body.privateLink as string;
    expect(fresh).not.toBe(link);
    expect((await guest.client.get(`/api/boards/${secret.id}`)).status).toBe(404);
    expect((await guest.client.post(`/api/private/${link}`)).status).toBe(404);
    await guest.client.post(`/api/private/${fresh}`);
    expect((await guest.client.get(`/api/boards/${secret.id}`)).status).toBe(200);

    const open = await owner.client.put(`/api/boards/${secret.id}/private`, { private: false });
    expect(open.body).toMatchObject({ board: { private: false }, privateLink: null });
    expect((await guest.client.get(`/api/boards/${secret.id}`)).status).toBe(404);
  });

  it('keep their link, password and people when archived', async () => {
    t = await makeApp();
    const { owner, secret, link } = await privateBoard('hush');
    const guest = await signUp(t.app, 'Visitor');
    await guest.client.post(`/api/private/${link}`);
    await guest.client.post(`/api/boards/${secret.id}/unlock`, { password: 'hush' });

    const { board: next, saved } = (await owner.client.post(`/api/boards/${secret.id}/archive`, {})).body as { board: BoardDto; saved: BoardDto };
    expect(next).toMatchObject({ private: true, hasPassword: true, title: 'Leadership retro' });
    expect(saved.private).toBe(true);
    expect((await guest.client.get(`/api/boards/${next.id}`)).status).toBe(200);
    expect((await guest.client.post(`/api/private/${link}`)).body).toEqual({ boardId: next.id });
    // the saved one is kept for its creator and the team's admins
    expect((await guest.client.get(`/api/boards/${saved.id}`)).status).toBe(404);
    expect((await owner.client.get(`/api/boards/${saved.id}`)).status).toBe(200);
  });
});
