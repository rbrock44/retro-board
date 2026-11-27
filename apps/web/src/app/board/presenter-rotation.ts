/**
 * Picking who goes over a column. Everyone on the team goes once, in random order, before anyone goes twice.
 * Someone who can't right now ("passed") goes back in the list for later, but isn't picked again until someone
 * says yes: nobody who passed in a row is offered the turn again straight away.
 */

/** `done`: who has gone this round. `passed`: who said "not right now" since the last person said yes */
export interface Rotation { done: string[]; passed: string[] }

/** Who's next, or null when everyone left to ask has just passed (or there's nobody) */
export function pickNext(memberIds: string[], r: Rotation, random: () => number = Math.random): string | null {
  const members = [...new Set(memberIds)];
  const notPassed = members.filter(id => !r.passed.includes(id));
  // Those still to go this round; once only people who passed are left, borrow from those who've already gone
  let pool = notPassed.filter(id => !r.done.includes(id));
  if (!pool.length) pool = notPassed;
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** They'll do it: they've gone this round, and a fresh round starts once everyone has */
export function accept(memberIds: string[], r: Rotation, id: string): Rotation {
  const members = new Set(memberIds);
  const done = [...new Set([...r.done, id])].filter(x => members.has(x));
  return { done: [...members].every(m => done.includes(m)) ? [] : done, passed: [] };
}

/** Not right now: still owed a turn, but skipped until someone else says yes */
export function pass(r: Rotation, id: string): Rotation {
  return { done: r.done, passed: r.passed.includes(id) ? r.passed : [...r.passed, id] };
}
