import { describe, expect, it } from 'vitest';
import {
  THEME_PRESETS, canVoteBoard, canWriteBoard, contrastRatio, personHue, positionAfter, positionBetween,
  readableTextOn, sanitizeTokens,
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

describe('board access', () => {
  const base = { role: 'member' as const, isCreator: false, status: 'open' as const, locked: false };
  it('lets members write an open board', () => expect(canWriteBoard(base)).toBe(true));
  it('never lets viewers write or like cards', () => {
    expect(canWriteBoard({ ...base, role: 'viewer' })).toBe(false);
    expect(canVoteBoard({ ...base, role: 'viewer' })).toBe(false);
  });
  it('locks members out of writing but not liking', () => {
    expect(canWriteBoard({ ...base, locked: true })).toBe(false);
    expect(canVoteBoard({ ...base, locked: true })).toBe(true);
  });
  it('lets the creator write a locked board', () => {
    expect(canWriteBoard({ ...base, locked: true, isCreator: true })).toBe(true);
  });
  it('makes closed boards read-only for everyone', () => {
    expect(canWriteBoard({ ...base, role: 'admin', status: 'archived' })).toBe(false);
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

describe('personHue', () => {
  const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

  it('is stable for the same id', () => {
    expect(personHue('u-alex')).toBe(personHue('u-alex'));
    expect(personHue('8f14e45f-ceea-4672-a8b6-1b0c2a7d9e01')).toBe(personHue('8f14e45f-ceea-4672-a8b6-1b0c2a7d9e01'));
  });

  it('stays in 0-359, including for an empty id', () => {
    for (const id of ['', 'a', 'u-alex', 'x'.repeat(500), '🎨 émoji']) {
      const h = personHue(id);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it('spreads different ids across the wheel', () => {
    const hues = Array.from({ length: 200 }, (_, i) => personHue(`user-${i}`));
    const buckets = new Set(hues.map(h => Math.floor(h / 30)));
    expect(buckets.size).toBe(12);
    expect(new Set(hues).size).toBeGreaterThan(100);
  });

  it('keeps the demo people visibly apart', () => {
    // The in-browser demo's sample people (and the demo's own "you"); closest pair is about 42 degrees apart
    const hues = ['u-alex', 'u-sam', 'u-priya', 'u-jordan', 'u-glenn', 'demo-you'].map(personHue);
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) expect(gap(hues[i]!, hues[j]!)).toBeGreaterThanOrEqual(40);
    }
  });
});
