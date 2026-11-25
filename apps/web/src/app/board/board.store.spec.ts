import type { BoardStateDto, CardDto } from '@retro/shared';
import { applyEvent, boardTabTitle, groupLikes } from './board.store';

const card = (id: string, extra: Partial<CardDto> = {}): CardDto => ({
  id, boardId: 'b', columnId: 'c1', parentId: null, groupTitle: null, position: 'a0', body: id, anonymous: false,
  author: null, mine: false, status: 'none', likes: 0, liked: false, attachments: [], reactions: [], replies: [],
  carriedFrom: null, createdAt: '', editedAt: null, ...extra,
});

const state = (): BoardStateDto => ({
  board: { id: 'b', teamId: 't', title: 'B', status: 'open', createdAt: '', closedAt: null, createdBy: null, cardCount: 0, actionCount: 0,
    settings: { allowAnonymous: true, locked: false } },
  team: { id: 't', name: 'T' },
  columns: [{ id: 'c1', boardId: 'b', title: 'One', description: '', color: '#000000', position: 'a0' }],
  cards: [card('x')],
  actions: [],
  members: [],
  permissions: { role: 'member', canWrite: true, canVote: true, canFacilitate: false },
});

describe('applyEvent', () => {
  it('inserts and replaces cards by id', () => {
    let s = applyEvent(state(), { type: 'card.upsert', card: card('y') });
    expect(s.cards.map(c => c.id)).toEqual(['x', 'y']);
    s = applyEvent(s, { type: 'card.upsert', card: card('x', { body: 'edited' }) });
    expect(s.cards.find(c => c.id === 'x')!.body).toBe('edited');
    expect(s.cards).toHaveLength(2);
  });

  it('drops a column together with its cards', () => {
    const s = applyEvent(state(), { type: 'column.delete', id: 'c1' });
    expect(s.columns).toEqual([]);
    expect(s.cards).toEqual([]);
  });

  it('keeps columns sorted by position', () => {
    const s = applyEvent(state(), { type: 'column.upsert', column: { id: 'c0', boardId: 'b', title: 'Zero', description: '', color: '#ffffff', position: 'Zz' } });
    expect(s.columns.map(c => c.id)).toEqual(['c0', 'c1']);
  });

  it('shows a like as soon as the card comes back', () => {
    const s = applyEvent(state(), { type: 'card.upsert', card: card('x', { likes: 1, liked: true }) });
    expect(s.cards.find(c => c.id === 'x')).toMatchObject({ likes: 1, liked: true });
  });

  it('does not mutate the previous state', () => {
    const before = state();
    applyEvent(before, { type: 'card.delete', id: 'x' });
    expect(before.cards).toHaveLength(1);
  });
});

describe('groupLikes', () => {
  it('adds up a group head and its cards', () => {
    expect(groupLikes(card('h', { likes: 2 }), [card('a', { likes: 3 }), card('b', { likes: 1 })])).toBe(6);
  });
});

describe('boardTabTitle', () => {
  it('calls the open Current board Current, including older ones still named "Current retro"', () => {
    expect(boardTabTitle({ title: 'Current', status: 'open' }, 'Platform Team', 'Retro Board')).toBe('Current - Platform Team - Retro Board');
    expect(boardTabTitle({ title: 'Current retro', status: 'open' }, 'Platform Team', 'Retro Board')).toBe('Current - Platform Team - Retro Board');
  });

  it('uses the title for history boards', () => {
    expect(boardTabTitle({ title: '2026-11-24 · Sprint 42', status: 'archived' }, 'Platform Team', 'Retro Board'))
      .toBe('2026-11-24 · Sprint 42 - Platform Team - Retro Board');
    expect(boardTabTitle({ title: 'Current retro', status: 'archived' }, 'Platform Team', 'Retro Board'))
      .toBe('Current retro - Platform Team - Retro Board');
  });

  it('uses the title for other open boards', () => {
    expect(boardTabTitle({ title: 'Planning', status: 'open' }, 'Platform Team', 'Team Retros')).toBe('Planning - Platform Team - Team Retros');
  });
});
