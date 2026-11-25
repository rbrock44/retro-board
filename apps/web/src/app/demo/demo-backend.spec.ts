import { describe, expect, it } from 'vitest';
import type { BoardDto, BoardEvent, BoardStateDto, CardDto, TeamDto } from '@retro/shared';
import { DemoBackend } from './demo-backend';
import { DEMO_ME, seedDemo } from './demo-data';

function backend() {
  let changes = 0;
  const b = new DemoBackend(seedDemo(), () => changes++);
  return { b, changes: () => changes };
}

describe('demo backend', () => {
  it('serves the sample teams and a live board', async () => {
    const { b } = backend();
    const teams = (await b.handle('GET', '/api/teams')) as TeamDto[];
    expect(teams.map(t => t.name)).toEqual(['Corn Belt Platform', 'Des Moines Design Crew']);
    const state = (await b.handle('GET', '/api/boards/b-s42')) as BoardStateDto;
    expect(state.columns.map(c => c.title)).toEqual(['Carried Over', 'Went Well', 'To Improve', 'Action Ideas']);
    expect(state.permissions.canFacilitate).toBe(true);
    expect(state.cards.some(c => c.carriedFrom?.boardTitle.endsWith(' · Sprint 41'))).toBe(true);
    expect(state.cards.find(c => c.groupTitle === 'Test reliability')).toBeTruthy();
  });

  it('lets you like a card once and unlike it, like the server', async () => {
    const { b } = backend();
    const likesOf = async (id: string) => ((await b.handle('GET', '/api/boards/b-s42')) as BoardStateDto).cards.find(c => c.id === id)!;
    const state = (await b.handle('GET', '/api/boards/b-s42')) as BoardStateDto;
    const fresh = state.cards.find(c => !c.liked && !c.parentId)!;
    await b.handle('POST', `/api/cards/${fresh.id}/vote`);
    await b.handle('POST', `/api/cards/${fresh.id}/vote`);
    expect(await likesOf(fresh.id)).toMatchObject({ likes: fresh.likes + 1, liked: true });
    await b.handle('DELETE', `/api/cards/${fresh.id}/vote`);
    expect(await likesOf(fresh.id)).toMatchObject({ likes: fresh.likes, liked: false });
    expect(state.board.settings).toEqual({ allowAnonymous: true, locked: false, theme: null });
  });

  it('adds cards, plays events back to the board, and reports changes', async () => {
    const { b, changes } = backend();
    const events: BoardEvent[] = [];
    const off = b.subscribe('b-s42', { onEvent: e => events.push(e), onTyping: () => {} });
    const state = (await b.handle('GET', '/api/boards/b-s42')) as BoardStateDto;
    const card = (await b.handle('POST', '/api/boards/b-s42/cards', { columnId: state.columns[1].id, body: 'hello' })) as CardDto;
    expect(card).toMatchObject({ body: 'hello', mine: true });
    expect(events.some(e => e.type === 'card.upsert' && e.card.id === card.id)).toBe(true);
    expect(changes()).toBeGreaterThan(0);
    off();
  });

  it('carries marked cards into the next retro once', async () => {
    const { b } = backend();
    const live = (await b.handle('GET', '/api/boards/b-s42')) as BoardStateDto;
    const target = live.cards.find(c => !c.carriedFrom)!;
    await b.handle('PATCH', `/api/cards/${target.id}`, { status: 'carry_over' });
    const next = (await b.handle('POST', '/api/teams/t-platform/boards', { title: 'Sprint 43 retro' })) as BoardDto;
    const s = (await b.handle('GET', `/api/boards/${next.id}`)) as BoardStateDto;
    expect(s.columns[0].title).toBe('Carried Over');
    expect(s.cards.map(c => c.body)).toEqual([target.body]);
    const again = (await b.handle('POST', '/api/teams/t-platform/boards', { title: 'Sprint 44 retro' })) as BoardDto;
    expect(((await b.handle('GET', `/api/boards/${again.id}`)) as BoardStateDto).cards).toEqual([]);
  });

  it('saves the board to history and starts a fresh one with the carried cards', async () => {
    const { b } = backend();
    const events: BoardEvent[] = [];
    b.subscribe('b-s42', { onEvent: e => events.push(e), onTyping: () => {} });
    const live = (await b.handle('GET', '/api/boards/b-s42')) as BoardStateDto;
    const target = live.cards.find(c => !c.carriedFrom && !c.parentId && live.columns.find(col => col.id === c.columnId)?.title === 'To Improve')!;
    await b.handle('PATCH', `/api/cards/${target.id}`, { status: 'carry_over' });

    const r = (await b.handle('POST', '/api/boards/b-s42/archive', { name: 'Sprint 42', date: '2026-11-24' })) as { saved: BoardDto; board: BoardDto };
    expect(r.saved).toMatchObject({ title: '2026-11-24 · Sprint 42', status: 'archived' });
    expect(events.some(e => e.type === 'board.next' && e.boardId === r.board.id)).toBe(true);

    const next = (await b.handle('GET', `/api/boards/${r.board.id}`)) as BoardStateDto;
    expect(next.columns.map(c => c.title)).toEqual(['Went Well', 'To Improve', 'Action Ideas']);
    expect(next.cards.map(c => c.body)).toEqual([target.body]);
    expect(next.columns.find(c => c.id === next.cards[0].columnId)?.title).toBe('To Improve');

    // opening the team now lands on the fresh board
    expect(await b.handle('POST', '/api/teams/t-platform/current')).toEqual({ boardId: r.board.id });
  });

  it('refuses writes on an archived board', async () => {
    const { b } = backend();
    const past = (await b.handle('GET', '/api/boards/b-s41')) as BoardStateDto;
    await expect(b.handle('POST', '/api/boards/b-s41/cards', { columnId: past.columns[0].id, body: 'late' })).rejects.toThrow(/archived/);
  });

  it('lets you switch to another person', async () => {
    const { b } = backend();
    const me = (await b.handle('POST', '/api/auth/guest/claim', { userId: 'u-alex' })) as { name: string };
    expect(me.name).toBe('John Wayne');
    expect(b.state.meId).not.toBe(DEMO_ME);
  });

  it('exports markdown without a server', () => {
    const { b } = backend();
    const file = b.exportBoard('b-s42', 'md');
    expect(file.name).toBe('current.md');
    expect(file.text).toContain('## Went Well');
  });
});
