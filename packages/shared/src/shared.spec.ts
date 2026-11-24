import { describe, expect, it } from 'vitest';
import {
  THEME_PRESETS, canVoteBoard, canWriteBoard, contrastRatio, positionAfter, positionBetween,
  readableTextOn, sanitizeTokens, voteBlockedReason,
} from './index';

describe('positions', () => {
  it('sorts new keys between neighbours', () => {
    const a = positionAfter(null);
    const c = positionAfter(a);
    const b = positionBetween(a, c);
    expect([c, a, b].sort()).toEqual([a, b, c]);
  });

  it('recovers when neighbours arrive out of order', () => {
    const a = positionAfter(null);
    const b = positionAfter(a);
    expect(positionBetween(b, a) > b).toBe(true);
  });
});

describe('votes', () => {
  const settings = { votesPerUser: 3, maxVotesPerCard: 2 };
  it('allows votes under both limits', () => {
    expect(voteBlockedReason({ usedOnBoard: 1, usedOnCard: 1, settings })).toBeNull();
  });
  it('blocks past the board budget', () => {
    expect(voteBlockedReason({ usedOnBoard: 3, usedOnCard: 0, settings })).toMatch(/all 3 votes/);
  });
  it('blocks past the per-card cap', () => {
    expect(voteBlockedReason({ usedOnBoard: 2, usedOnCard: 2, settings })).toMatch(/per card/);
  });
});

describe('board access', () => {
  const base = { role: 'member' as const, isCreator: false, status: 'open' as const, locked: false };
  it('lets members write an open board', () => expect(canWriteBoard(base)).toBe(true));
  it('never lets viewers write or vote', () => {
    expect(canWriteBoard({ ...base, role: 'viewer' })).toBe(false);
    expect(canVoteBoard({ ...base, role: 'viewer' })).toBe(false);
  });
  it('locks members out of writing but not voting', () => {
    expect(canWriteBoard({ ...base, locked: true })).toBe(false);
    expect(canVoteBoard({ ...base, locked: true })).toBe(true);
  });
  it('lets the creator write a locked board', () => {
    expect(canWriteBoard({ ...base, locked: true, isCreator: true })).toBe(true);
  });
  it('makes closed boards read-only for everyone', () => {
    expect(canWriteBoard({ ...base, role: 'admin', status: 'closed' })).toBe(false);
  });
});

describe('themes', () => {
  it('drops invalid tokens and keeps valid ones', () => {
    const t = sanitizeTokens({ bg: '#ABCDEF', text: 'red', accent: 42 });
    expect(t.bg).toBe('#abcdef');
    expect(t.text).toBe(THEME_PRESETS[0].tokens.text);
  });
  it('picks readable text colors', () => {
    expect(readableTextOn('#ffff00')).toBe('#000000');
    expect(readableTextOn('#1e1e1e')).toBe('#ffffff');
  });
  it('ships presets whose text is readable on their background', () => {
    for (const p of THEME_PRESETS) {
      expect(contrastRatio(p.tokens.text, p.tokens.bg), p.id).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(p.tokens.accentText, p.tokens.accent), p.id).toBeGreaterThanOrEqual(3);
    }
  });
});
