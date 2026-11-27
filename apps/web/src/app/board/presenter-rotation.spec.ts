import { accept, pass, pickNext, type Rotation } from './presenter-rotation';

const team = ['a', 'b', 'c'];
const fresh = (): Rotation => ({ done: [], passed: [] });

describe('presenter rotation', () => {
  it('gives everyone one turn before anyone goes again', () => {
    let r = fresh();
    const order: string[] = [];
    for (let i = 0; i < team.length; i++) {
      const id = pickNext(team, r)!;
      expect(order).not.toContain(id);
      order.push(id);
      r = accept(team, r, id);
    }
    expect(order.sort()).toEqual(team);
    expect(r.done).toEqual([]);
  });

  it('skips people who passed in a row, then lets them be picked again after a yes', () => {
    let r = pass(fresh(), 'a');
    for (let i = 0; i < 20; i++) expect(pickNext(team, r)).not.toBe('a');
    r = pass(r, 'b');
    expect(pickNext(team, r)).toBe('c');
    r = accept(team, r, 'c');
    expect(r.passed).toEqual([]);
    expect(['a', 'b']).toContain(pickNext(team, r));
  });

  it('borrows from people who already went when only people who passed are left', () => {
    const r: Rotation = { done: ['a', 'b'], passed: ['c'] };
    expect(['a', 'b']).toContain(pickNext(team, r));
  });

  it('has nobody to offer once everyone passed', () => {
    const r: Rotation = { done: [], passed: ['a', 'b', 'c'] };
    expect(pickNext(team, r)).toBeNull();
    expect(pickNext([], fresh())).toBeNull();
  });

  it('forgets people who left the team', () => {
    expect(accept(['a', 'b'], { done: ['gone'], passed: [] }, 'a').done).toEqual(['a']);
  });
});
