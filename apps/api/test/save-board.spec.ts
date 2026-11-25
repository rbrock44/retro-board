import { afterEach, describe, expect, it } from 'vitest';
import type { BoardStateDto, BoardSummaryDto } from '@retro/shared';
import { addMember, makeApp, teamWithBoard, type TestApp } from './helpers';

let t: TestApp;
afterEach(async () => t?.close());

describe('saving a board and the current board', () => {
  it('files the board under the date and name, and starts a fresh one with only the carried cards', async () => {
    t = await makeApp();
    const { owner, team, board, state } = await teamWithBoard(t.app);
    const [start, stop] = state.columns;
    const keep = (await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: stop.id, body: 'stop late deploys' })).body;
    await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: start.id, body: 'pairing' });
    await owner.client.patch(`/api/cards/${keep.id}`, { status: 'carry_over' });

    const res = await owner.client.post(`/api/boards/${board.id}/save`, { name: 'Sprint 1', date: '2026-11-24' });
    expect(res.status).toBe(200);
    expect(res.body.saved).toMatchObject({ id: board.id, title: '2026-11-24 · Sprint 1', status: 'closed' });
    expect(res.body.board).toMatchObject({ title: 'Current', status: 'open' });

    const next = (await owner.client.get(`/api/boards/${res.body.board.id}`)).body as BoardStateDto;
    // same columns, no "Carried over" column needed: the card goes back into the column it came from
    expect(next.columns.map(c => c.title)).toEqual(state.columns.map((c: { title: string }) => c.title));
    expect(next.cards).toHaveLength(1);
    expect(next.cards[0]).toMatchObject({ body: 'stop late deploys', columnId: next.columns[1].id, status: 'none' });
    expect(next.cards[0].carriedFrom).toMatchObject({ boardId: board.id, boardTitle: '2026-11-24 · Sprint 1' });

    // the old board is in the history, read-only
    const history = (await owner.client.get(`/api/teams/${team.id}/boards`)).body as BoardSummaryDto[];
    expect(history.map(b => [b.title, b.status])).toEqual(expect.arrayContaining([['2026-11-24 · Sprint 1', 'closed'], ['Current', 'open']]));
    expect((await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: start.id, body: 'late' })).status).toBe(403);
    expect((await owner.client.post(`/api/boards/${board.id}/save`, {})).status).toBe(400);
  });

  it('recognises an older lowercase "Carried over" column when saving', async () => {
    t = await makeApp();
    const { owner, board } = await teamWithBoard(t.app);
    await owner.client.post(`/api/boards/${board.id}/columns`, { title: 'Carried over', color: '#a855f7' });
    const res = await owner.client.post(`/api/boards/${board.id}/save`, {});
    const next = (await owner.client.get(`/api/boards/${res.body.board.id}`)).body as BoardStateDto;
    expect(next.columns.map(c => c.title.toLowerCase())).not.toContain('carried over');
  });

  it('only lets facilitators save', async () => {
    t = await makeApp();
    const { owner, team, board } = await teamWithBoard(t.app);
    const member = await addMember(t.app, owner.client, team.id, 'member');
    expect((await member.client.post(`/api/boards/${board.id}/save`, {})).status).toBe(403);
  });

  it('opens a team on its current board, making one when there is none', async () => {
    t = await makeApp();
    const { owner, team, board } = await teamWithBoard(t.app);
    expect((await owner.client.post(`/api/teams/${team.id}/current`)).body).toEqual({ boardId: board.id });

    await owner.client.patch(`/api/boards/${board.id}`, { status: 'closed' });
    const viewer = await addMember(t.app, owner.client, team.id, 'viewer');
    expect((await viewer.client.post(`/api/teams/${team.id}/current`)).body).toEqual({ boardId: null });

    const made = (await owner.client.post(`/api/teams/${team.id}/current`)).body;
    expect(made.boardId).toBeTruthy();
    expect(made.boardId).not.toBe(board.id);
    const s = (await owner.client.get(`/api/boards/${made.boardId}`)).body as BoardStateDto;
    expect(s.board.title).toBe('Current');
    expect(s.columns.length).toBeGreaterThan(0);
    // and asking again returns the same board rather than another new one
    expect((await owner.client.post(`/api/teams/${team.id}/current`)).body).toEqual({ boardId: made.boardId });
  });
});
