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
    expect(teams.map(t => t.name)).toEqual(['Design Crew', 'Platform Team']);
    const state = (await b.handle('GET', '/api/boards/b-s42')) as BoardStateDto;
    expect(state.columns.map(c => c.title)).toEqual(['Carried over', 'Went well', 'To improve', 'Action ideas']);
    expect(state.permissions.canFacilitate).toBe(true);
    expect(state.cards.some(c => c.carriedFrom?.boardTitle === 'Sprint 41 retro')).toBe(true);
    expect(state.cards.find(c => c.groupTitle === 'Test reliability')).toBeTruthy();
  });

  it('enforces the vote budget like the server', async () => {
    const { b } = backend();
    const state = (await b.handle('GET', '/api/boards/b-s42')) as BoardStateDto;
    const fresh = state.cards.find(c => c.myVotes === 0 && !c.parentId)!;
    const left = 6 - state.myVotesUsed;
    for (let i = 0; i < Math.min(left, 3); i++) await b.handle('POST', `/api/cards/${fresh.id}/vote`);
    await expect(b.handle('POST', `/api/cards/${fresh.id}/vote`)).rejects.toThrow(/votes/);
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
    expect(s.columns[0].title).toBe('Carried over');
    expect(s.cards.map(c => c.body)).toEqual([target.body]);
    const again = (await b.handle('POST', '/api/teams/t-platform/boards', { title: 'Sprint 44 retro' })) as BoardDto;
    expect(((await b.handle('GET', `/api/boards/${again.id}`)) as BoardStateDto).cards).toEqual([]);
  });

  it('refuses writes on a closed board', async () => {
    const { b } = backend();
    const past = (await b.handle('GET', '/api/boards/b-s41')) as BoardStateDto;
    await expect(b.handle('POST', '/api/boards/b-s41/cards', { columnId: past.columns[0].id, body: 'late' })).rejects.toThrow(/closed/);
  });

  it('lets you switch to another person', async () => {
    const { b } = backend();
    const me = (await b.handle('POST', '/api/auth/guest/claim', { userId: 'u-alex' })) as { name: string };
    expect(me.name).toBe('Alex Rivera');
    expect(b.state.meId).not.toBe(DEMO_ME);
  });

  it('exports markdown without a server', () => {
    const { b } = backend();
    const file = b.exportBoard('b-s42', 'md');
    expect(file.name).toBe('sprint-42-retro.md');
    expect(file.text).toContain('## Went well');
  });
});
