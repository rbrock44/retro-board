import { CdkDrag, CdkDragPlaceholder, CdkDropList, CdkDropListGroup, type CdkDragDrop, type CdkDragMove } from '@angular/cdk/drag-drop';
import { Component, computed, effect, inject, input, OnDestroy, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import {
  CARD_STATUSES, CARD_STATUS_LABELS, COLOR_PRESETS, type CardDto, type CardStatus, type ColumnDto,
  type BoardDto,
} from '@retro/shared';
import { Api } from '../core/api.service';
import { themeStyle } from '../core/theme.service';
import { ToastService } from '../core/toast.service';
import { DemoService } from '../demo/demo.service';
import { AuthService } from '../core/auth.service';
import { ActionList } from '../shared/action-list';
import { Avatar } from '../shared/avatar';
import { ColorPicker } from '../shared/color-picker';
import { Modal } from '../shared/modal';
import { BoardStore, boardTabTitle, type DropSpot } from './board.store';
import { dropSpotAt } from './drop-spot';
import { TeamPhoto } from '../shared/team-photo';
import { Card } from './card';
import { Composer, type ComposerResult } from './composer';
import { ClickOutside } from '../shared/click-outside';

@Component({
  selector: 'app-board-page',
  providers: [BoardStore],
  imports: [TeamPhoto, ClickOutside, 
    FormsModule, RouterLink, CdkDropListGroup, CdkDropList, CdkDrag, CdkDragPlaceholder,
    Card, Composer, Avatar, ActionList, Modal, ColorPicker, DatePipe,
  ],
  host: {
    '(document:keydown)': 'onKey($event)',
  },
  template: `
    @if (store.error(); as err) {
      <div class="page"><p class="error" role="alert">{{ err }}</p><a routerLink="/">Back to teams</a></div>
    } @else if (store.state(); as s) {
      <div class="board-root" [style]="boardStyle()">
        <header class="board-bar">
          <div class="board-title">
            <p class="crumbs"><app-team-photo [team]="s.team" [size]="18" /> {{ s.team.name }} · <a [routerLink]="['/teams', s.team.id, 'history']">History</a></p>
            @if (editingTitle()) {
              <input class="title-edit" [value]="s.board.title" (change)="rename($event)" (blur)="editingTitle.set(false)"
                     (keydown.enter)="$any($event.target).blur()" autofocus aria-label="Board title">
            } @else {
              <h1 (dblclick)="editingTitle.set(perm().canFacilitate)">{{ s.board.title }}</h1>
            }
            <span class="status" [attr.data-status]="s.board.status">{{ s.board.status }}</span>
            @if (s.board.settings.locked) { <span class="tag" title="Only facilitators can add or edit cards; voting still works">🔒 locked</span> }
            @if (!store.connected()) { <span class="tag danger" title="Reconnecting for live updates">offline</span> }
          </div>
          <div class="spacer"></div>
          @if (auth.on('presence')) {
            <div class="presence" aria-label="People here now">
              @for (u of store.presence().slice(0, 8); track u.id) { <app-avatar [user]="u" [size]="26" /> }
              @if (store.presence().length > 8) { <span class="more">+{{ store.presence().length - 8 }}</span> }
            </div>
          }
        </header>

        @if (s.board.status !== 'open') {
          <div class="history-note no-print" role="note">
            <span>📚 This board is in the team's history{{ s.board.closedAt ? ', archived ' + (s.board.closedAt | date: 'mediumDate') : '' }}. It's read-only.</span>
            <a class="btn small" [routerLink]="['/teams', s.team.id]">Go to the Current Board</a>
            <a class="btn small ghost" [routerLink]="['/teams', s.team.id, 'history']">All Past Boards</a>
          </div>
        }

        <div class="board-tools no-print">
          <label>Show
            <select [ngModel]="store.statusFilter()" (ngModelChange)="store.statusFilter.set($event)">
              <option value="all">All Cards</option>
              @for (st of statuses; track st) { @if (st !== 'carry_over' || auth.on('carryOver')) { <option [value]="st">{{ labels[st] }}</option> } }
            </select>
          </label>
          <label>Sort
            <select [ngModel]="store.sort()" (ngModelChange)="store.sort.set($event)">
              <option value="position">Oldest First</option>
              <option value="newest">Newest First</option>
              @if (auth.on('likes')) { <option value="likes">Most Liked</option> }
            </select>
          </label>
          <div class="spacer"></div>
          @if (auth.on('actions')) {
            <button type="button" class="btn ghost" data-tour="actions" (click)="sidebar.set(!sidebar())" [attr.aria-expanded]="sidebar()">
              Action Items ({{ store.openActions().length }})
            </button>
          }
          @if (s.board.status !== 'open' && auth.on('export')) {
          <span class="menu-wrap" (clickOutside)="exportOpen.set(false)">
            <button type="button" class="btn ghost" (click)="exportOpen.set(!exportOpen())" [attr.aria-expanded]="exportOpen()">Export</button>
            @if (exportOpen()) {
              <div class="menu right" role="menu" (click)="exportOpen.set(false)">
                <a role="menuitem" [href]="'/api/boards/' + s.board.id + '/export?format=md'" download (click)="exportDemo($event, 'md')">Markdown (.md)</a>
                <a role="menuitem" [href]="'/api/boards/' + s.board.id + '/export?format=csv'" download (click)="exportDemo($event, 'csv')">Spreadsheet (.csv)</a>
                <button type="button" role="menuitem" (click)="print()">Print / PDF</button>
              </div>
            }
          </span>
          }
          @if (perm().canFacilitate && s.board.status === 'open') {
            <button type="button" class="btn primary" data-tour="archive" (click)="openArchive()" title="Move this board to the history and start a fresh one">🗄 Archive Board</button>
          }
          @if (perm().canFacilitate) { <button type="button" class="btn" data-tour="board-settings" (click)="openSettings()">⚙ Board Settings</button> }
        </div>

        @if (store.arrangeMode()) {
          <div class="arrange-strip no-print" role="status">
            <span class="am-icon" aria-hidden="true">✥</span>
            <span><strong>Arrange Mode is on.</strong> Drag cards to move them.
              @if (auth.on('groups')) { Drop on the middle of a card or group to group them, or on its top or bottom edge to place it there. }
              @else { Drop on the top or bottom half of a card to place it there. }</span>
            <button type="button" class="btn small primary" (click)="store.arrangeMode.set(false)">Done</button>
          </div>
        }
        @if (store.pickingGroupFor()) {
          <div class="banner" role="status">Click a card to create a group with it, or a group to add to it. <button type="button" class="link-btn" (click)="store.pickingGroupFor.set(null)">Cancel</button></div>
        }
        @if (s.board.status !== 'open') {
          <div class="banner" role="status">This board is {{ s.board.status }} and read-only.
            @if (perm().canFacilitate) { <button type="button" class="link-btn" (click)="store.updateBoard({ status: 'open' })">Reopen</button> }</div>
        }

        <div class="board-body">
          <div class="columns" [class.arrange-mode]="store.arrangeMode()" cdkDropListGroup>
            @for (col of s.columns; track col.id) {
              <section class="column" [style.--col]="col.color" [attr.aria-label]="col.title">
                <header class="column-head">
                  <span class="col-bar"></span>
                  <h2>{{ col.title }}</h2>
                  <span class="count">{{ (store.columnCards().get(col.id) ?? []).length }}</span>
                  <div class="spacer"></div>
                  @if (perm().canWrite) {
                    <button type="button" class="icon-btn small no-print arrange-toggle" [class.on]="store.arrangeMode()"
                            [attr.aria-pressed]="store.arrangeMode()" aria-label="Arrange Mode" (click)="store.arrangeMode.set(!store.arrangeMode())"
                            [title]="store.arrangeMode() ? 'Arrange Mode is on. Click to lock the cards again (A)' : 'Arrange Mode: drag cards to move' + (auth.on('groups') ? ' or group' : '') + ' them (A)'">✥</button>
                  }
                  <button type="button" class="icon-btn small no-print" (click)="focusColumn.set(col.id)"
                          [attr.aria-label]="'Focus on ' + col.title" title="Focus on this column (full screen)">⤢</button>
                  @if (perm().canFacilitate) {
                    <button type="button" class="icon-btn small no-print" (click)="editColumn(col)" [attr.aria-label]="'Edit column ' + col.title">✎</button>
                  }
                </header>
                @if (col.description) { <p class="col-desc">{{ col.description }}</p> }

                @if (perm().canWrite) {
                  <div class="no-print">
                    <app-composer [boardId]="s.board.id" [allowAnonymous]="s.board.settings.allowAnonymous"
                                  (submitted)="add(col.id, $event)" (typed)="store.sendTyping(col.id)" />
                  </div>
                }
                @if (auth.on('presence') && store.typingIn(col.id).length) {
                  <p class="typing">{{ store.typingIn(col.id).join(', ') }} typing…</p>
                }

                <div class="card-list" cdkDropList [cdkDropListData]="col.id" [id]="'col-' + col.id" [cdkDropListEnterPredicate]="columnTakes"
                     [cdkDropListSortingDisabled]="true" (cdkDropListDropped)="drop($event)">
                  @for (card of store.columnCards().get(col.id) ?? []; track card.id) {
                    <div cdkDrag [cdkDragData]="card" [cdkDragDisabled]="!perm().canWrite || !store.arrangeMode()" class="drag-wrap"
                         [attr.data-wrap-id]="card.id" [class.drop-before]="spotAt(card.id, 'before')" [class.drop-after]="spotAt(card.id, 'after')"
                         (cdkDragMoved)="dragMoved($event)" (cdkDragEnded)="store.dropSpot.set(null)">
                      <app-card [card]="card" [boardId]="s.board.id" />
                      <div *cdkDragPlaceholder class="drag-placeholder"></div>
                    </div>
                  } @empty {
                    <p class="empty-col">No cards yet</p>
                  }
                </div>
              </section>
            }
            @if (perm().canFacilitate) {
              <button type="button" class="add-column no-print" (click)="newColumn()" aria-label="Add Column" data-tip="Add Column">＋</button>
            }
          </div>

          @if (sidebar() && auth.on('actions')) {
            <aside class="sidebar card-surface" aria-label="Action Items">
              <div class="row"><h2>Action Items</h2><div class="spacer"></div>
                <button type="button" class="icon-btn" (click)="sidebar.set(false)" aria-label="Close action items">✕</button></div>
              <p class="muted small">Open items from every retro in this team, plus the ones made here.</p>
              <app-action-list [actions]="store.boardActions()" [members]="s.members" [teamId]="s.team.id" [boardId]="s.board.id"
                               [canEdit]="perm().canVote" [showBoard]="true" />
            </aside>
          }
        </div>
      </div>

      @if (focused(); as fc) {
        <!-- one column as a big popup, for going over it together. ‹ › (or the arrow keys) step through the columns;
             clicking the dimmed margin around it closes it -->
        <div class="column-focus-backdrop" (click)="$event.target === $event.currentTarget && focusColumn.set(null)">
        <div class="column-focus" role="dialog" aria-modal="true" [attr.aria-label]="fc.col.title" [style.--col]="fc.col.color">
          <header class="focus-head">
            <span class="col-bar"></span>
            <h2>{{ fc.col.title }}</h2>
            <span class="count">{{ fc.cards.length }}</span>
            <div class="spacer"></div>
            <button type="button" class="icon-btn" (click)="stepFocus(-1)" [disabled]="fc.index === 0" aria-label="Previous column" title="Previous column (←)">‹</button>
            <span class="muted small">{{ fc.index + 1 }} / {{ s.columns.length }}</span>
            <button type="button" class="icon-btn" (click)="stepFocus(1)" [disabled]="fc.index === s.columns.length - 1" aria-label="Next column" title="Next column (→)">›</button>
            <button type="button" class="icon-btn" (click)="focusColumn.set(null)" aria-label="Close" title="Close (Esc)">✕</button>
          </header>
          <div class="focus-body">
            @if (fc.col.description) { <p class="col-desc">{{ fc.col.description }}</p> }
            <div class="focus-cards">
              @for (card of fc.cards; track card.id) {
                <app-card [card]="card" [boardId]="s.board.id" />
              } @empty {
                <p class="empty-col">No cards yet</p>
              }
            </div>
          </div>
        </div>
        </div>
      }

      @if (columnEdit(); as ce) {
        <app-modal [heading]="ce.id ? 'Edit Column' : 'New Column'" (closed)="columnEdit.set(null)">
          <form class="stack" (ngSubmit)="saveColumn()">
            <label>Title <input name="title" [(ngModel)]="ce.title" required maxlength="80" autofocus></label>
            <label>Description <input name="desc" [(ngModel)]="ce.description" maxlength="300" placeholder="Optional prompt shown under the title"></label>
            <div><span class="token-label">Color</span><app-color-picker [(value)]="ce.color" label="Column color" /></div>
            <div class="row wrap">
              @if (ce.id) {
                <button type="button" class="btn ghost" (click)="shiftColumn(-1)">← Move Left</button>
                <button type="button" class="btn ghost" (click)="shiftColumn(1)">Move Right →</button>
                <button type="button" class="btn ghost danger" (click)="deleteColumn()">Delete Column</button>
              }
              <div class="spacer"></div>
              <button type="submit" class="btn primary" [disabled]="!ce.title.trim()">Save</button>
            </div>
          </form>
        </app-modal>
      }

      @if (archiveOpen()) {
        <app-modal heading="Archive Board" (closed)="archiveOpen.set(false)">
          <form class="stack" (ngSubmit)="archiveBoard()">
            <p>This board moves to the team's history, kept exactly as it is now, and a fresh board with the same
              columns takes its place. You can open, read and export it from History any time.</p>
            <label>Name <span class="muted">(optional)</span>
              <input name="archiveName" [(ngModel)]="archiveName" maxlength="80" placeholder="e.g. Sprint 42" autofocus>
            </label>
            <p class="muted">Filed as <strong>{{ today }}{{ archiveName.trim() ? ' · ' + archiveName.trim() : '' }}</strong></p>
            <p class="muted">
              @if (carryCount()) { {{ carryCount() }} card{{ carryCount() === 1 ? '' : 's' }} marked <em>Carry Over</em> will move to the fresh board. }
              @else { No cards are marked <em>Carry Over</em>, so the fresh board starts empty. }
              Open action items show on it too.
            </p>
            <div class="row end">
              <button type="button" class="btn ghost" (click)="archiveOpen.set(false)">Cancel</button>
              <button type="submit" class="btn primary" [disabled]="archiving()">Archive and Start Fresh</button>
            </div>
          </form>
        </app-modal>
      }
      @if (settingsOpen()) {
        <app-modal heading="Board Settings" [wide]="true" (closed)="settingsOpen.set(false)">
          <div class="stack">
            <h3 class="settings-head">This Board</h3>
            <dl class="settings-grid">
              @if (auth.on('anonymous')) {
                <dt>Anonymous cards</dt><dd>{{ s.board.settings.allowAnonymous ? 'Allowed' : 'Off' }}</dd>
              }
              <dt>Lock</dt><dd>{{ s.board.settings.locked ? 'Locked: no new or edited cards' : 'Open' }}</dd>
              <dt>Colors</dt>
              <dd>
                @if (s.board.settings.theme; as t) {
                  <span class="swatch" [style.background]="t['accent'] ?? null"></span> Team colors
                } @else { Each person's own theme }
              </dd>
              <dt>Columns</dt>
              <dd class="col-chips">
                @for (c of s.columns; track c.id) { <span class="col-chip" [style.border-color]="c.color">{{ c.title }}</span> }
              </dd>
              <dt>Status</dt><dd>{{ s.board.status === 'open' ? 'Current' : 'Archived' }}</dd>
            </dl>
            <hr>
            <div class="row wrap">
              @if (s.permissions.role === 'admin') {
                <button type="button" class="btn ghost" (click)="saveTemplate()">Save Columns as Template</button>
              }
              @if (s.board.status === 'open') {
                <button type="button" class="btn" (click)="settingsOpen.set(false); openArchive()">Archive Board</button>
              }
              @if (s.permissions.role === 'admin') { <button type="button" class="btn ghost danger" (click)="deleteBoard()">Delete Board</button> }
            </div>
            <p class="settings-foot muted small">
              @if (s.permissions.role === 'admin') {
                <a [routerLink]="['/teams', s.team.id, 'history']" [queryParams]="{ tab: 'settings' }" (click)="settingsOpen.set(false)">Change in Team Settings →</a>
              } @else { Anonymous cards, lock and colors are set by a team admin in the team's Settings. }
            </p>
          </div>
        </app-modal>
      }
    } @else {
      <div class="page"><p class="muted">Loading board…</p></div>
    }
  `,
})
export class BoardPage implements OnDestroy {
  protected store = inject(BoardStore);
  private api = inject(Api);
  private router = inject(Router);
  private toast = inject(ToastService);
  private demo = inject(DemoService);
  protected auth = inject(AuthService);
  readonly boardId = input.required<string>();

  protected labels = CARD_STATUS_LABELS;
  protected statuses: CardStatus[] = CARD_STATUSES;
  protected sidebar = signal(false);
  protected exportOpen = signal(false);
  protected editingTitle = signal(false);
  protected settingsOpen = signal(false);
  protected columnEdit = signal<{ id: string | null; title: string; color: string; description: string } | null>(null);

  protected perm = computed(() => this.store.permissions() ?? { role: 'viewer', canWrite: false, canVote: false, canFacilitate: false });
  protected boardStyle = computed(() => {
    const t = this.store.board()?.settings.theme;
    return t ? themeStyle(t) : {};
  });

  protected archiveOpen = signal(false);
  protected archiveName = '';
  protected archiving = signal(false);
  protected today = localDate();
  protected carryCount = computed(() => this.store.cards().filter(c => c.status === 'carry_over').length);

  openArchive() {
    this.archiveName = '';
    this.today = localDate();
    this.archiveOpen.set(true);
  }

  async archiveBoard() {
    this.archiving.set(true);
    try {
      const r = await this.api.post<{ saved: BoardDto; board: BoardDto }>(`/api/boards/${this.boardId()}/archive`, { name: this.archiveName.trim() || undefined, date: this.today });
      this.archiveOpen.set(false);
      this.toast.show(`Archived “${r.saved.title}” to the history. This is the fresh board.`);
      await this.router.navigate(['/boards', r.board.id], { replaceUrl: true });
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.archiving.set(false);
    }
  }

  /** In demo mode there's no server to download from, so the file is built in the browser. */
  exportDemo(e: Event, format: 'md' | 'csv') {
    if (!this.demo.active()) return;
    e.preventDefault();
    this.demo.exportBoard(this.store.board()!.id, format);
  }

  constructor() {
    // Someone else archived the board: follow them to the fresh one.
    effect(() => {
      const next = this.store.next();
      if (!next || this.archiving()) return;
      this.toast.show(`The board was archived as “${next.savedTitle}”. Moved you to the fresh board.`);
      void this.router.navigate(['/boards', next.boardId], { replaceUrl: true });
    });
    effect(() => {
      const id = this.boardId();
      void this.store.open(id).then(() => {
        const b = this.store.board();
        if (b) void this.auth.welcome(b.teamId);
      });
    });
    // Tab title follows renames, status changes, the site name and moves to a fresh board. Reading navEnd re-runs
    // this after the route TitleStrategy (which sets the title right after NavigationEnd), so the board's title wins.
    const navEnd = toSignal(this.router.events.pipe(filter(e => e instanceof NavigationEnd)));
    effect(() => {
      navEnd();
      const s = this.store.state();
      if (!s || s.board.id !== this.boardId()) return;
      document.title = boardTabTitle(s.board, s.team.name, this.auth.siteName());
    });
  }

  ngOnDestroy() {
    this.store.close();
  }

  /** The column shown full screen, if any */
  protected focusColumn = signal<string | null>(null);
  protected focused = computed(() => {
    const id = this.focusColumn();
    const cols = this.store.columns();
    const index = cols.findIndex(c => c.id === id);
    if (index < 0) return null;
    return { col: cols[index], index, cards: this.store.columnCards().get(cols[index].id) ?? [] };
  });

  stepFocus(dir: -1 | 1) {
    const f = this.focused();
    const next = f && this.store.columns()[f.index + dir];
    if (next) this.focusColumn.set(next.id);
  }

  onKey(e: KeyboardEvent) {
    const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]');
    if (typing) return;
    if (this.focusColumn()) {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) this.focusColumn.set(null);
      if (e.key === 'ArrowLeft') this.stepFocus(-1);
      if (e.key === 'ArrowRight') this.stepFocus(1);
      return;
    }
    if (e.key === 'Escape') {
      this.store.pickingGroupFor.set(null);
      this.store.arrangeMode.set(false);
    }
    if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey && this.perm().canWrite) this.store.arrangeMode.update(v => !v);
  }

  add(columnId: string, r: ComposerResult) {
    void this.store.addCard(columnId, r.body, r.anonymous, r.attachmentIds);
  }

  /** Only in Arrange Mode (cards don't drag otherwise): group, place before or after a card, or move to a column's end */
  drop(e: CdkDragDrop<string, string, CardDto>) {
    const card = e.item.data;
    // A card dragged out of a group leaves it on its own; the rest of the group stays put
    const outOfGroup = e.previousContainer.id.startsWith('grp-');
    const spot = dropSpotAt(this.store, e.dropPoint, card, this.auth.on('groups'));
    if (spot?.mode === 'group') {
      void this.store.groupInto(card.id, spot.id);
      return;
    }
    if (spot) {
      void this.store.moveCard(card, spot.columnId, spot.index, outOfGroup);
      return;
    }
    // Dropped on an empty part of a column: to its end, unless it's already in that column
    const targetColumn = e.container.data;
    if (targetColumn === card.columnId && !outOfGroup) return;
    const list = (this.store.columnCards().get(targetColumn) ?? []).filter(c => c.id !== card.id);
    void this.store.moveCard(card, targetColumn, list.length, outOfGroup);
  }

  /**
   * A card dragged out of a group belongs to the column only once it's off every group: while it's over one, that
   * group's own list gets it (CDK would otherwise hand it to the column the group sits in).
   */
  protected columnTakes = (drag: CdkDrag<CardDto>) => {
    const p = this.store.dragPointer;
    if (!p || !drag.dropContainer?.id?.startsWith('grp-')) return true;
    return !document.elementsFromPoint(p.x, p.y).some(el => el.classList.contains('group-cards'));
  };

  /** Light up where the dragged card would land */
  dragMoved(e: CdkDragMove<CardDto>) {
    const spot = dropSpotAt(this.store, e.pointerPosition, e.source.data, this.auth.on('groups'));
    if (!sameSpot(spot, this.store.dropSpot())) this.store.dropSpot.set(spot);
  }

  protected spotAt(id: string, mode: DropSpot['mode']) {
    const s = this.store.dropSpot();
    return s?.id === id && s.mode === mode;
  }

  rename(e: Event) {
    const title = (e.target as HTMLInputElement).value.trim();
    if (title && title !== this.store.board()?.title) void this.store.updateBoard({ title });
    this.editingTitle.set(false);
  }

  newColumn() {
    const used = new Set(this.store.columns().map(c => c.color));
    this.columnEdit.set({ id: null, title: '', description: '', color: COLOR_PRESETS.find(c => !used.has(c)) ?? COLOR_PRESETS[0] });
  }

  editColumn(c: ColumnDto) {
    this.columnEdit.set({ id: c.id, title: c.title, color: c.color, description: c.description });
  }

  async saveColumn() {
    const ce = this.columnEdit()!;
    if (ce.id) await this.store.updateColumn(ce.id, { title: ce.title, color: ce.color, description: ce.description });
    else {
      const col = await this.store.addColumn(ce.title, ce.color);
      if (col && ce.description) await this.store.updateColumn(col.id, { description: ce.description });
    }
    this.columnEdit.set(null);
  }

  shiftColumn(dir: -1 | 1) {
    const ce = this.columnEdit()!;
    const col = this.store.columns().find(c => c.id === ce.id);
    if (col) void this.store.moveColumn(col, dir);
  }

  deleteColumn() {
    const ce = this.columnEdit()!;
    const n = (this.store.cards().filter(c => c.columnId === ce.id)).length;
    if (!confirm(n ? `Delete “${ce.title}” and its ${n} cards?` : `Delete “${ce.title}”?`)) return;
    void this.store.deleteColumn(ce.id!);
    this.columnEdit.set(null);
  }

  openSettings() {
    this.settingsOpen.set(true);
  }


  async saveTemplate() {
    const name = prompt('Template name', this.store.board()?.title);
    if (!name?.trim()) return;
    try {
      await this.api.post(`/api/boards/${this.boardId()}/save-template`, { name: name.trim() });
      this.toast.show(`Saved “${name.trim()}” as a team template`);
    } catch (err) {
      this.toast.error(err);
    }
  }

  async deleteBoard() {
    if (!confirm('Delete this board, its cards and media for good?')) return;
    const teamId = this.store.state()!.team.id;
    try {
      await this.api.delete(`/api/boards/${this.boardId()}`);
      await this.router.navigate(['/teams', teamId, 'history']);
    } catch (err) {
      this.toast.error(err);
    }
  }

  print() {
    setTimeout(() => window.print(), 50);
  }
}

/** Today as YYYY-MM-DD in the browser's time zone */
function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sameSpot(a: DropSpot | null, b: DropSpot | null) {
  return a?.id === b?.id && a?.mode === b?.mode && a?.index === b?.index;
}
