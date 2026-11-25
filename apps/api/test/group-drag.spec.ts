import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BoardStateDto } from '@retro/shared';
import { makeApp, teamWithBoard, type TestApp } from './helpers';

describe('dragging cards inside groups', () => {
  let t: TestApp;
  beforeEach(async () => { t = await makeApp(); });
  afterEach(async () => t.close());

  async function groupOfThree() {
    const { owner, board, state } = await teamWithBoard(t.app);
    const col = state.columns[0].id;
    const add = async (body: string) => (await owner.client.post(`/api/boards/${board.id}/cards`, { columnId: col, body })).body.id as string;
    const [a, b, c, loose] = [await add('a'), await add('b'), await add('c'), await add('loose')];
    await owner.client.post(`/api/cards/${b}/group`, { targetId: a });
    await owner.client.post(`/api/cards/${c}/group`, { targetId: a });
    await owner.client.patch(`/api/cards/${a}`, { groupTitle: 'Flaky' });
    const get = async () => ((await owner.client.get(`/api/boards/${board.id}`)).body as BoardStateDto).cards;
    return { owner, board, col, ids: { a, b, c, loose }, get, cols: state.columns };
  }

  it('reorders a group, and the new first card leads it with the name', async () => {
    const { owner, ids, get } = await groupOfThree();
    expect((await owner.client.post(`/api/cards/${ids.b}/arrange`, { order: [ids.c, ids.a, ids.b] })).status).toBe(200);
    const cards = await get();
    const by = (id: string) => cards.find(x => x.id === id)!;
    expect(by(ids.c)).toMatchObject({ parentId: null, groupTitle: 'Flaky' });
    expect(by(ids.a)).toMatchObject({ parentId: ids.c, groupTitle: null });
    expect(by(ids.b).parentId).toBe(ids.c);
    expect(by(ids.a).position < by(ids.b).position).toBe(true);
  });

  it('drags the leading card out alone, leaving the rest grouped', async () => {
    const { owner, ids, get, cols } = await groupOfThree();
    await owner.client.post(`/api/cards/${ids.a}/move`, { columnId: cols[1].id, position: 'm', alone: true });
    const cards = await get();
    const by = (id: string) => cards.find(x => x.id === id)!;
    expect(by(ids.a)).toMatchObject({ parentId: null, columnId: cols[1].id, groupTitle: null });
    expect(by(ids.b)).toMatchObject({ parentId: null, columnId: cols[0].id, groupTitle: 'Flaky' });
    expect(by(ids.c).parentId).toBe(ids.b);
  });

  it('pulls a card from one group into another at a chosen spot', async () => {
    const { owner, ids, get } = await groupOfThree();
    await owner.client.post(`/api/cards/${ids.loose}/arrange`, { order: [ids.loose, ids.c] });
    expect(((await get()).find(x => x.id === ids.c)!).parentId).toBe(ids.loose);
    // and the first group still has a and b
    expect(((await get()).find(x => x.id === ids.b)!).parentId).toBe(ids.a);
    expect((await owner.client.post(`/api/cards/${ids.a}/arrange`, { order: [ids.a] })).status).toBe(400);
  });
});
