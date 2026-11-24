import type { BoardStateDto, CardDto } from '@retro/shared';
import { applyEvent, groupVotes } from './board.store';

const card = (id: string, extra: Partial<CardDto> = {}): CardDto => ({
  id, boardId: 'b', columnId: 'c1', parentId: null, groupTitle: null, position: 'a0', body: id, anonymous: false,
  author: null, mine: false, status: 'none', votes: 0, myVotes: 0, attachments: [], reactions: [], replies: [],
  carriedFrom: null, createdAt: '', editedAt: null, ...extra,
});

const state = (): BoardStateDto => ({
  board: { id: 'b', teamId: 't', title: 'B', status: 'open', createdAt: '', closedAt: null, createdBy: null, cardCount: 0, actionCount: 0,
    settings: { allowAnonymous: true, votesPerUser: 5, maxVotesPerCard: 3, locked: false } },
  team: { id: 't', name: 'T' },
  columns: [{ id: 'c1', boardId: 'b', title: 'One', description: '', color: '#000000', position: 'a0' }],
  cards: [card('x')],
  actions: [],
  members: [],
  permissions: { role: 'member', canWrite: true, canVote: true, canFacilitate: false },
  myVotesUsed: 0,
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

  it('tracks my vote budget', () => {
    expect(applyEvent(state(), { type: 'votes.used', used: 4 }).myVotesUsed).toBe(4);
  });

  it('does not mutate the previous state', () => {
    const before = state();
    applyEvent(before, { type: 'card.delete', id: 'x' });
    expect(before.cards).toHaveLength(1);
  });
});

describe('groupVotes', () => {
  it('adds up a group head and its cards', () => {
    expect(groupVotes(card('h', { votes: 2 }), [card('a', { votes: 3 }), card('b', { votes: 1 })])).toBe(6);
  });
});
