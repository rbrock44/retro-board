import type { ActionItemDto, BoardDto, CardDto, ColumnDto, UserDto } from './models';

/** Every change to a board is broadcast to its room as one of these. Upserts carry the whole entity. */
export type BoardEvent =
  | { type: 'board.update'; board: BoardDto }
  | { type: 'column.upsert'; column: ColumnDto }
  | { type: 'column.delete'; id: string }
  | { type: 'card.upsert'; card: CardDto }
  | { type: 'card.delete'; id: string }
  | { type: 'action.upsert'; action: ActionItemDto }
  | { type: 'action.delete'; id: string }
  | { type: 'presence'; users: UserDto[] }
  /** The board was archived to history and a fresh one started; everyone on it moves to the new one */
  | { type: 'board.next'; boardId: string; savedTitle: string };

export const SOCKET_EVENTS = {
  join: 'board:join',
  leave: 'board:leave',
  event: 'board:event',
  typing: 'board:typing',
} as const;
