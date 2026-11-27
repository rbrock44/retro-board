import { afterEach, describe, expect, it } from 'vitest';
import type { TeamDto } from '@retro/shared';
import { Client, addMember, makeApp, teamWithBoard, type TestApp } from './helpers';

let t: TestApp;
afterEach(async () => t?.close());

/** A second browser for the same person: same session, none of the team cookies */
function otherBrowser(app: TestApp['app'], c: Client): Client {
  const b = new Client(app);
  b.jar.set('rb_session', c.jar.get('rb_session')!);
  return b;
}

describe('team password', () => {
  it('keeps everyone out until they type it, and the setting browser always in', async () => {
    t = await makeApp();
    const { owner, team, board } = await teamWithBoard(t.app);
    const member = await addMember(t.app, owner.client, team.id, 'member');

    const set = await owner.client.put(`/api/teams/${team.id}/password`, { password: 'sprint' });
    expect(set.status).toBe(200);
    expect((set.body as TeamDto).password).toEqual({ set: true, unlocked: true, owner: true });

    // the member is locked out of everything in the team
    const board1 = await member.client.get(`/api/boards/${board.id}`);
    expect(board1.status).toBe(423);
    expect(board1.body).toMatchObject({ lockedTeam: { id: team.id, name: 'Platform' } });
    expect((await member.client.get(`/api/teams/${team.id}`)).status).toBe(423);
    expect((await member.client.post('/api/export', { boardIds: [board.id] })).status).toBe(423);
    // ...but still sees the team in the list, marked
    const list = (await member.client.get('/api/teams')).body as TeamDto[];
    expect(list[0].password).toEqual({ set: true, unlocked: false, owner: false });

    expect((await member.client.post(`/api/teams/${team.id}/unlock`, { password: 'nope' })).status).toBe(400);
    expect((await member.client.post(`/api/teams/${team.id}/unlock`, { password: 'sprint' })).status).toBe(200);
    expect((await member.client.get(`/api/boards/${board.id}`)).status).toBe(200);

    // the browser that set it gets in without typing anything
    expect((await owner.client.get(`/api/boards/${board.id}`)).status).toBe(200);
  });

  it('needs the old password to change it, except in the browser that set it', async () => {
    t = await makeApp();
    const { owner, team, board } = await teamWithBoard(t.app);
    const admin = await addMember(t.app, owner.client, team.id, 'admin');
    const member = await addMember(t.app, owner.client, team.id, 'member');
    await owner.client.put(`/api/teams/${team.id}/password`, { password: 'first' });
    await member.client.post(`/api/teams/${team.id}/unlock`, { password: 'first' });

    // another admin: must give the current one; members can't at all
    expect((await admin.client.put(`/api/teams/${team.id}/password`, { password: 'second' })).status).toBe(400);
    expect((await admin.client.put(`/api/teams/${team.id}/password`, { current: 'wrong', password: 'second' })).status).toBe(400);
    expect((await member.client.put(`/api/teams/${team.id}/password`, { current: 'first', password: 'x1234' })).status).toBe(403);
    const changed = await admin.client.put(`/api/teams/${team.id}/password`, { current: 'first', password: 'second' });
    expect(changed.status).toBe(200);
    expect((changed.body as TeamDto).password).toEqual({ set: true, unlocked: true, owner: false });

    // changing it signs everyone else out
    expect((await member.client.get(`/api/boards/${board.id}`)).status).toBe(423);

    // the original browser forgot the password: sets a new one without it, and is still the original
    const reset = await owner.client.put(`/api/teams/${team.id}/password`, { password: 'third' });
    expect(reset.status).toBe(200);
    expect((reset.body as TeamDto).password.owner).toBe(true);
    // the same person in a different browser is not the original one
    const laptop = otherBrowser(t.app, owner.client);
    expect((await laptop.get(`/api/boards/${board.id}`)).status).toBe(423);
    expect((await laptop.put(`/api/teams/${team.id}/password`, { password: 'fourth' })).status).toBe(400);

    // removing it needs the same proof, and opens the team to everyone
    expect((await admin.client.put(`/api/teams/${team.id}/password`, { current: 'third', password: null })).status).toBe(200);
    expect((await member.client.get(`/api/boards/${board.id}`)).status).toBe(200);
  });

  it('slows down guessing', async () => {
    t = await makeApp();
    const { owner, team } = await teamWithBoard(t.app);
    const member = await addMember(t.app, owner.client, team.id, 'member');
    await owner.client.put(`/api/teams/${team.id}/password`, { password: 'secret' });
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await member.client.post(`/api/teams/${team.id}/unlock`, { password: `guess${i}` })).status);
    expect(codes).toContain(429);
    expect((await member.client.post(`/api/teams/${team.id}/unlock`, { password: 'secret' })).status).toBe(429);
  });
});
