import { Injectable, computed, inject, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import {
  CURRENT_BOARD_TITLE, OLD_CURRENT_BOARD_TITLE,
  SOCKET_EVENTS, byPosition, positionBetween, type ActionItemDto, type BoardEvent, type BoardStateDto, type CardDto,
  type BoardSummaryDto, type CardStatus, type ColumnDto, type UserDto,
} from '@retro/shared';
import { Api } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { DemoService } from '../demo/demo.service';

/** position: Oldest First, the order cards sit in (new ones go to the bottom; dragging rearranges).
 *  newest: Newest First. likes: Most Liked. Only position can be rearranged by dragging. */
export type SortMode = 'position' | 'newest' | 'likes';

/** Applies one realtime event to a board state. Pure, so it is easy to test. */
export function applyEvent(s: BoardStateDto, e: BoardEvent): BoardStateDto {
  switch (e.type) {
    case 'board.update':
      return { ...s, board: e.board };
    case 'column.upsert':
      return { ...s, columns: upsert(s.columns, e.column).sort(byPosition) };
    case 'column.delete':
      return { ...s, columns: s.columns.filter(c => c.id !== e.id), cards: s.cards.filter(c => c.columnId !== e.id) };
    case 'card.upsert':
      return { ...s, cards: upsert(s.cards, e.card) };
    case 'card.delete':
      return { ...s, cards: s.cards.filter(c => c.id !== e.id) };
    case 'action.upsert':
      return { ...s, actions: upsert(s.actions, e.action) };
    case 'action.delete':
      return { ...s, actions: s.actions.filter(a => a.id !== e.id) };
    case 'presence':
    case 'board.next':
      return s;
  }
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex(x => x.id === item.id);
  if (i === -1) return [...list, item];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}

/** Likes on a group head plus every card in its group. */
export function groupLikes(head: CardDto, kids: CardDto[]): number {
  return head.likes + kids.reduce((n, k) => n + k.likes, 0);
}



/** Browser tab title for a board page: "Current - Team - Site" for the team's current board, else the board's title. */
export function boardTabTitle(board: Pick<BoardSummaryDto, 'title' | 'status'>, teamName: string, siteName: string): string {
  const name = board.status === 'open' && board.title === OLD_CURRENT_BOARD_TITLE ? CURRENT_BOARD_TITLE : board.title;
  return `${name} - ${teamName} - ${siteName}`;
}

/** One board's live state. Provided by the board page, so each open board gets its own store and socket. */
@Injectable()
export class BoardStore {
  private api = inject(Api);
  private toast = inject(ToastService);
  private socket: Socket | null = null;
  private demo = inject(DemoService);
  private demoOff: (() => void) | null = null;
  private boardId = '';

  readonly state = signal<BoardStateDto | null>(null);
  readonly presence = signal<UserDto[]>([]);
  readonly typing = signal<Record<string, { name: string; at: number }>>({});
  readonly connected = signal(false);
  readonly error = signal<string | null>(null);
  /** Set when the board is saved to history and a fresh one started; the page moves everyone there */
  readonly next = signal<{ boardId: string; savedTitle: string } | null>(null);

  readonly sort = signal<SortMode>('position');
  readonly statusFilter = signal<CardStatus | 'all'>('all');
  readonly groupMode = signal(false);
  /** In Group Mode, the card or group a dragged card would join if dropped now (highlighted) */
  readonly dropTarget = signal<string | null>(null);
  readonly pickingGroupFor = signal<string | null>(null);

  readonly board = computed(() => this.state()?.board ?? null);
  readonly columns = computed(() => this.state()?.columns ?? []);
  readonly cards = computed(() => this.state()?.cards ?? []);
  readonly actions = computed(() => this.state()?.actions ?? []);
  readonly members = computed(() => this.state()?.members ?? []);
  readonly permissions = computed(() => this.state()?.permissions ?? null);
  readonly openActions = computed(() => this.actions().filter(a => a.status === 'open'));
  readonly boardActions = computed(() => {
    const id = this.board()?.id;
    return this.actions().filter(a => a.boardId === id || a.status === 'open');
  });

  readonly childrenOf = computed(() => {
    const map = new Map<string, CardDto[]>();
    for (const c of this.cards()) {
      if (!c.parentId) continue;
      const list = map.get(c.parentId) ?? [];
      list.push(c);
      map.set(c.parentId, list);
    }
    for (const list of map.values()) list.sort(byPosition);
    return map;
  });

  /** Group heads and loose cards per column, in display order, with the status filter applied. */
  readonly columnCards = computed(() => {
    const filter = this.statusFilter();
    const sort = this.sort();
    const kids = this.childrenOf();
    const ids = new Set(this.cards().map(c => c.id));
    const map = new Map<string, CardDto[]>();
    for (const col of this.columns()) map.set(col.id, []);
    for (const c of this.cards()) {
      // A card whose head was deleted elsewhere shows on its own until the server catches up.
      if (c.parentId && ids.has(c.parentId)) continue;
      if (filter !== 'all' && c.status !== filter) continue;
      map.get(c.columnId)?.push(c);
    }
    for (const list of map.values()) {
      if (sort === 'likes') list.sort((a, b) => groupLikes(b, kids.get(b.id) ?? []) - groupLikes(a, kids.get(a.id) ?? []) || byPosition(a, b));
      else if (sort === 'newest') list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || byPosition(b, a));
      else list.sort(byPosition);
    }
    return map;
  });

  async open(boardId: string) {
    this.close();
    this.boardId = boardId;
    this.error.set(null);
    this.next.set(null);
    try {
      this.state.set(await this.api.get<BoardStateDto>(`/api/boards/${boardId}`));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load the board');
      return;
    }
    if (this.demo.active()) {
      this.demoOff = this.demo.subscribe(boardId, e => this.handle(e), t => this.onTyping(t));
      this.connected.set(true);
      return;
    }
    const socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], withCredentials: true });
    this.socket = socket;
    socket.on('connect', () => {
      socket.emit(SOCKET_EVENTS.join, boardId, async (r: { ok: boolean; error?: string }) => {
        if (!r.ok) return this.toast.show(r.error ?? 'Live updates unavailable', 'error');
        this.connected.set(true);
        // Catch up on anything missed while disconnected.
        if (socket.recovered === false && this.state()) await this.reload();
      });
    });
    socket.on('disconnect', () => this.connected.set(false));
    socket.on(SOCKET_EVENTS.event, (e: BoardEvent) => this.handle(e));
    socket.on(SOCKET_EVENTS.typing, (t: { user: UserDto; columnId: string }) => this.onTyping(t));
  }

  private onTyping(t: { user: UserDto; columnId: string }) {
    this.typing.update(m => ({ ...m, [t.columnId + ':' + t.user.id]: { name: t.user.name, at: Date.now() } }));
    setTimeout(() => this.typing.update(m => {
      const next = { ...m };
      for (const [k, v] of Object.entries(next)) if (Date.now() - v.at > 2500) delete next[k];
      return next;
    }), 3000);
  }

  async reload() {
    const fresh = await this.api.get<BoardStateDto>(`/api/boards/${this.boardId}`);
    this.state.set(fresh);
  }

  close() {
    this.demoOff?.();
    this.demoOff = null;
    if (this.socket) {
      this.socket.emit(SOCKET_EVENTS.leave, this.boardId);
      this.socket.close();
      this.socket = null;
    }
    this.connected.set(false);
  }

  handle(e: BoardEvent) {
    if (e.type === 'presence') {
      this.presence.set(e.users);
      return;
    }
    if (e.type === 'board.next') {
      this.next.set({ boardId: e.boardId, savedTitle: e.savedTitle });
      return;
    }
    const s = this.state();
    if (!s) return;
    const next = applyEvent(s, e);
    // Permissions depend on board status and lock, so refresh them when the board changes.
    if (e.type === 'board.update' && (e.board.status !== s.board.status || e.board.settings.locked !== s.board.settings.locked)) {
      void this.reload();
    }
    this.state.set(next);
  }

  typingIn(columnId: string): string[] {
    const out: string[] = [];
    for (const [k, v] of Object.entries(this.typing())) if (k.startsWith(columnId + ':')) out.push(v.name);
    return out;
  }

  sendTyping(columnId: string) {
    this.socket?.emit(SOCKET_EVENTS.typing, this.boardId, columnId);
  }

  // ---- mutations: server is the source of truth; events bring the result back ----

  private async run<T>(p: Promise<T>): Promise<T | undefined> {
    try {
      return await p;
    } catch (err) {
      this.toast.error(err);
      return undefined;
    }
  }

  private patchCardLocal(id: string, patch: Partial<CardDto>) {
    this.state.update(s => (s ? { ...s, cards: s.cards.map(c => (c.id === id ? { ...c, ...patch } : c)) } : s));
  }

  addCard(columnId: string, body: string, anonymous: boolean, attachmentIds: string[]) {
    return this.run(this.api.post<CardDto>(`/api/boards/${this.boardId}/cards`, { columnId, body, anonymous, attachmentIds })
      .then(card => { this.handle({ type: 'card.upsert', card }); return card; }));
  }

  editCard(id: string, patch: { body?: string; anonymous?: boolean; attachmentIds?: string[]; removeAttachmentIds?: string[]; groupTitle?: string | null }) {
    return this.run(this.api.patch(`/api/cards/${id}`, patch));
  }

  setStatus(id: string, status: CardStatus) {
    this.patchCardLocal(id, { status });
    return this.run(this.api.patch(`/api/cards/${id}`, { status }));
  }

  deleteCard(id: string) {
    this.handle({ type: 'card.delete', id });
    return this.run(this.api.delete(`/api/cards/${id}`));
  }

  /** Moves a card to `index` within the visible list of `columnId` (which never contains the card itself). */
  moveCard(card: CardDto, columnId: string, index: number) {
    const list = (this.columnCards().get(columnId) ?? []).filter(c => c.id !== card.id);
    const before = list[index - 1]?.position ?? null;
    const after = list[index]?.position ?? null;
    const position = positionBetween(before, after);
    if (card.columnId === columnId && card.position === position) return undefined;
    this.patchCardLocal(card.id, { columnId, position, parentId: null });
    for (const k of this.childrenOf().get(card.id) ?? []) this.patchCardLocal(k.id, { columnId });
    return this.run(this.api.post(`/api/cards/${card.id}/move`, { columnId, position }));
  }

  groupInto(cardId: string, targetId: string) {
    if (cardId === targetId) return undefined;
    this.pickingGroupFor.set(null);
    return this.run(this.api.post(`/api/cards/${cardId}/group`, { targetId }));
  }

  ungroup(cardId: string) {
    return this.run(this.api.post(`/api/cards/${cardId}/ungroup`));
  }

  /** Like or unlike a card. One like per person; the card comes back over the socket. */
  toggleLike(card: CardDto) {
    const url = `/api/cards/${card.id}/vote`;
    return this.run(card.liked ? this.api.delete(url) : this.api.post(url));
  }

  react(targetType: 'card' | 'reply', targetId: string, emoji: string) {
    return this.run(this.api.post('/api/reactions', { targetType, targetId, emoji }));
  }

  reply(cardId: string, body: string, parentId: string | null, attachmentIds: string[]) {
    return this.run(this.api.post(`/api/cards/${cardId}/replies`, { body, parentId, attachmentIds }));
  }

  editReply(id: string, body: string) {
    return this.run(this.api.patch(`/api/replies/${id}`, { body }));
  }

  deleteReply(id: string) {
    return this.run(this.api.delete(`/api/replies/${id}`));
  }

  addColumn(title: string, color: string) {
    return this.run(this.api.post<ColumnDto>(`/api/boards/${this.boardId}/columns`, { title, color }));
  }

  updateColumn(id: string, patch: Partial<Pick<ColumnDto, 'title' | 'color' | 'description' | 'position'>>) {
    return this.run(this.api.patch(`/api/columns/${id}`, patch));
  }

  moveColumn(col: ColumnDto, dir: -1 | 1) {
    const cols = this.columns();
    const i = cols.findIndex(c => c.id === col.id);
    const j = i + dir;
    if (j < 0 || j >= cols.length) return undefined;
    const rest = cols.filter(c => c.id !== col.id);
    const before = rest[j - 1]?.position ?? null;
    const after = rest[j]?.position ?? null;
    return this.updateColumn(col.id, { position: positionBetween(before, after) });
  }

  deleteColumn(id: string) {
    return this.run(this.api.delete(`/api/columns/${id}`));
  }

  updateBoard(patch: Record<string, unknown>) {
    return this.run(this.api.patch(`/api/boards/${this.boardId}`, patch));
  }

  createAction(title: string, cardId: string | null) {
    const teamId = this.state()!.team.id;
    return this.run(this.api.post<ActionItemDto>(`/api/teams/${teamId}/actions`, { title, cardId, boardId: this.boardId }));
  }
}
