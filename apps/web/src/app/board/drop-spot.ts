import type { CardDto } from '@retro/shared';
import type { BoardStore, DropSpot } from './board.store';

/**
 * Where a card dragged in Arrange Mode would land with the pointer here. Each card or group on the board has a
 * top and bottom edge (drop there to place it before or after) and a middle (drop there to group with it). With
 * grouping off the card is split in half; in a computed sort order (newest, most liked) there are no edges.
 * Null when the pointer isn't over another card or group.
 */
export function dropSpotAt(store: BoardStore, point: { x: number; y: number }, dragged: CardDto, canGroup: boolean): DropSpot | null {
  for (const el of document.elementsFromPoint(point.x, point.y)) {
    if (el.closest('.cdk-drag-preview')) continue;
    const wrap = el.closest<HTMLElement>('.drag-wrap[data-wrap-id]');
    if (!wrap) continue;
    const id = wrap.dataset['wrapId']!;
    const target = store.cards().find(c => c.id === id);
    if (!target || id === dragged.id) return null;

    const ordered = store.sort() === 'position';
    const r = wrap.getBoundingClientRect();
    const edge = !ordered ? 0 : canGroup ? Math.min(r.height * 0.25, 32) : r.height / 2;
    const mode = point.y < r.top + edge ? 'before' : point.y > r.bottom - edge ? 'after' : canGroup ? 'group' : null;
    // Its own group already has it
    if (!mode || (mode === 'group' && id === dragged.parentId)) return null;

    const list = (store.columnCards().get(target.columnId) ?? []).filter(c => c.id !== dragged.id);
    const index = list.findIndex(c => c.id === id) + (mode === 'after' ? 1 : 0);
    return { id, mode, columnId: target.columnId, index };
  }
  return null;
}
