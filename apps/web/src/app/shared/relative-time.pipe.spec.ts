import { relativeTime } from './relative-time.pipe';

describe('relativeTime', () => {
  const now = Date.parse('2026-06-15T12:00:00Z');
  it('says just now for recent times', () => expect(relativeTime('2026-06-15T11:59:40Z', now)).toBe('just now'));
  it('uses the largest fitting unit', () => {
    expect(relativeTime('2026-06-15T09:00:00Z', now)).toBe('3 hours ago');
    expect(relativeTime('2026-06-13T12:00:00Z', now)).toBe('2 days ago');
  });
  it('is empty for missing dates', () => expect(relativeTime(null, now)).toBe(''));
});
