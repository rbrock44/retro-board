import { CdkDrag, CdkDragPlaceholder, CdkDropList, CdkDropListGroup, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { Component, computed, effect, inject, input, OnDestroy, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import {
  CARD_STATUSES, CARD_STATUS_LABELS, COLOR_PRESETS, THEME_PRESETS, type CardDto, type CardStatus, type ColumnDto,
  type ThemePreference, type BoardDto,
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
import { ThemeEditor } from '../shared/theme-editor';
import { BoardStore, boardTabTitle } from './board.store';
import { Card } from './card';
import { Composer, type ComposerResult } from './composer';

@Component({
  selector: 'app-board-page',
  providers: [BoardStore],
  imports: [
    FormsModule, RouterLink, CdkDropListGroup, CdkDropList, CdkDrag, CdkDragPlaceholder,
    Card, Composer, Avatar, ActionList, Modal, ColorPicker, ThemeEditor, DatePipe,
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
            <p class="crumbs">{{ s.team.name }} · <a [routerLink]="['/teams', s.team.id, 'history']">History</a></p>
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
          <div class="presence" aria-label="People here now">
            @for (u of store.presence().slice(0, 8); track u.id) { <app-avatar [user]="u" [size]="26" /> }
            @if (store.presence().length > 8) { <span class="more">+{{ store.presence().length - 8 }}</span> }
          </div>
        </header>

        @if (s.board.status !== 'open') {
          <div class="history-note no-print" role="note">
            <span>📚 This board is in the team's history{{ s.board.closedAt ? ', saved ' + (s.board.closedAt | date: 'mediumDate') : '' }}. It's read-only.</span>
            <a class="btn small" [routerLink]="['/teams', s.team.id]">Go to the current board</a>
            <a class="btn small ghost" [routerLink]="['/teams', s.team.id, 'history']">All past boards</a>
          </div>
        }

        <div class="board-tools no-print">
          <label>Show
            <select [ngModel]="store.statusFilter()" (ngModelChange)="store.statusFilter.set($event)">
              <option value="all">All cards</option>
              @for (st of statuses; track st) { <option [value]="st">{{ labels[st] }}</option> }
            </select>
          </label>
          <label>Sort
            <select [ngModel]="store.sort()" (ngModelChange)="store.sort.set($event)">
              <option value="position">Manual</option>
              <option value="likes">Most liked</option>
            </select>
          </label>
          @if (perm().canWrite) {
            <button type="button" class="chip" [class.active]="store.groupMode()" (click)="store.groupMode.set(!store.groupMode())"
                    title="Drag a card onto another card to group them (G)">⧉ Group mode</button>
          }
          <div class="spacer"></div>
          <button type="button" class="btn ghost" (click)="sidebar.set(!sidebar())" [attr.aria-expanded]="sidebar()">
            ✅ Actions ({{ store.openActions().length }})
          </button>
          <span class="menu-wrap">
            <button type="button" class="btn ghost" (click)="exportOpen.set(!exportOpen())" [attr.aria-expanded]="exportOpen()">Export</button>
            @if (exportOpen()) {
              <div class="menu right" role="menu" (click)="exportOpen.set(false)">
                <a role="menuitem" [href]="'/api/boards/' + s.board.id + '/export?format=md'" download (click)="exportDemo($event, 'md')">Markdown (.md)</a>
                <a role="menuitem" [href]="'/api/boards/' + s.board.id + '/export?format=csv'" download (click)="exportDemo($event, 'csv')">Spreadsheet (.csv)</a>
                <button type="button" role="menuitem" (click)="print()">Print / PDF</button>
              </div>
            }
          </span>
          @if (perm().canFacilitate && s.board.status === 'open') {
            <button type="button" class="btn primary" (click)="openSave()" title="File this board in the history and start a fresh one">💾 Save board</button>
          }
          @if (perm().canFacilitate) { <button type="button" class="btn" (click)="openSettings()">⚙ Board settings</button> }
        </div>

        @if (store.pickingGroupFor()) {
          <div class="banner" role="status">Click a card to create a group with it, or a group to add to it. <button type="button" class="link-btn" (click)="store.pickingGroupFor.set(null)">Cancel</button></div>
        }
        @if (s.board.status !== 'open') {
          <div class="banner" role="status">This board is {{ s.board.status }} and read-only.
            @if (perm().canFacilitate) { <button type="button" class="link-btn" (click)="store.updateBoard({ status: 'open' })">Reopen</button> }</div>
        }

        <div class="board-body">
          <div class="columns" cdkDropListGroup>
            @for (col of s.columns; track col.id) {
              <section class="column" [style.--col]="col.color" [attr.aria-label]="col.title">
                <header class="column-head">
                  <span class="col-bar"></span>
                  <h2>{{ col.title }}</h2>
                  <span class="count">{{ (store.columnCards().get(col.id) ?? []).length }}</span>
                  <div class="spacer"></div>
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
                @if (store.typingIn(col.id).length) {
                  <p class="typing">{{ store.typingIn(col.id).join(', ') }} typing…</p>
                }

                <div class="card-list" cdkDropList [cdkDropListData]="col.id" [id]="'col-' + col.id"
                     [cdkDropListSortingDisabled]="store.groupMode() || store.sort() === 'likes'"
                     (cdkDropListDropped)="drop($event)">
                  @for (card of store.columnCards().get(col.id) ?? []; track card.id) {
                    <div cdkDrag [cdkDragData]="card" [cdkDragDisabled]="!perm().canWrite" class="drag-wrap">
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
              <button type="button" class="add-column no-print" (click)="newColumn()" aria-label="Add column" data-tip="Add column">＋</button>
            }
          </div>

          @if (sidebar()) {
            <aside class="sidebar card-surface" aria-label="Action items">
              <div class="row"><h2>Action items</h2><div class="spacer"></div>
                <button type="button" class="icon-btn" (click)="sidebar.set(false)" aria-label="Close action items">✕</button></div>
              <p class="muted small">Open items from every retro in this team, plus the ones made here.</p>
              <app-action-list [actions]="store.boardActions()" [members]="s.members" [teamId]="s.team.id" [boardId]="s.board.id"
                               [canEdit]="perm().canVote" [showBoard]="true" />
            </aside>
          }
        </div>
      </div>

      @if (columnEdit(); as ce) {
        <app-modal [heading]="ce.id ? 'Edit column' : 'New column'" (closed)="columnEdit.set(null)">
          <form class="stack" (ngSubmit)="saveColumn()">
            <label>Title <input name="title" [(ngModel)]="ce.title" required maxlength="80" autofocus></label>
            <label>Description <input name="desc" [(ngModel)]="ce.description" maxlength="300" placeholder="Optional prompt shown under the title"></label>
            <div><span class="token-label">Color</span><app-color-picker [(value)]="ce.color" label="Column color" /></div>
            <div class="row wrap">
              @if (ce.id) {
                <button type="button" class="btn ghost" (click)="shiftColumn(-1)">← Move left</button>
                <button type="button" class="btn ghost" (click)="shiftColumn(1)">Move right →</button>
                <button type="button" class="btn ghost danger" (click)="deleteColumn()">Delete column</button>
              }
              <div class="spacer"></div>
              <button type="submit" class="btn primary" [disabled]="!ce.title.trim()">Save</button>
            </div>
          </form>
        </app-modal>
      }

      @if (saveOpen()) {
        <app-modal heading="Save board" (closed)="saveOpen.set(false)">
          <form class="stack" (ngSubmit)="saveBoard()">
            <p>This board goes into the team's history as it is now, and a fresh board with the same columns takes its place.</p>
            <label>Name <span class="muted">(optional)</span>
              <input name="saveName" [(ngModel)]="saveName" maxlength="80" placeholder="e.g. Sprint 42" autofocus>
            </label>
            <p class="muted">Saved as <strong>{{ today }}{{ saveName.trim() ? ' · ' + saveName.trim() : '' }}</strong></p>
            <p class="muted">
              @if (carryCount()) { {{ carryCount() }} card{{ carryCount() === 1 ? '' : 's' }} marked <em>Carry over</em> will move to the fresh board. }
              @else { No cards are marked <em>Carry over</em>, so the fresh board starts empty. }
              Open action items show on it too.
            </p>
            <div class="row end">
              <button type="button" class="btn ghost" (click)="saveOpen.set(false)">Cancel</button>
              <button type="submit" class="btn primary" [disabled]="saving()">Save and start fresh</button>
            </div>
          </form>
        </app-modal>
      }
      @if (settingsOpen()) {
        <app-modal heading="Board settings" [wide]="true" (closed)="settingsOpen.set(false)">
          <form class="stack" (ngSubmit)="saveSettings()">
            <label class="check"><input name="anon" type="checkbox" [(ngModel)]="form.allowAnonymous"> Allow anonymous cards</label>
            <label class="check"><input name="lock" type="checkbox" [(ngModel)]="form.locked"> Lock board (no new or edited cards; likes and reactions stay open)</label>

            <fieldset>
              <legend>Board theme</legend>
              <label class="check"><input name="themed" type="checkbox" [(ngModel)]="form.themed"> Give this board its own colors (everyone sees them)</label>
              @if (form.themed) {
                <app-theme-editor [value]="form.theme" (valueChange)="form.theme = $event" [compact]="true" />
              }
            </fieldset>

            <div class="row wrap">
              <button type="submit" class="btn primary">Save settings</button>
              <div class="spacer"></div>
              @if (s.permissions.role === 'admin') {
                <button type="button" class="btn ghost" (click)="saveTemplate()">Save columns as template</button>
              }
            </div>
            <hr>
            <div class="row wrap">
              @if (s.board.status === 'open') {
                <button type="button" class="btn" (click)="setStatus('closed')">Close board</button>
              } @else {
                <button type="button" class="btn" (click)="setStatus('open')">Reopen board</button>
              }
              @if (s.board.status !== 'archived') { <button type="button" class="btn ghost" (click)="setStatus('archived')">Archive</button> }
              @if (s.permissions.role === 'admin') { <button type="button" class="btn ghost danger" (click)="deleteBoard()">Delete board</button> }
            </div>
          </form>
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
  private auth = inject(AuthService);
  readonly boardId = input.required<string>();

  protected labels = CARD_STATUS_LABELS;
  protected statuses: CardStatus[] = CARD_STATUSES;
  protected sidebar = signal(false);
  protected exportOpen = signal(false);
  protected editingTitle = signal(false);
  protected settingsOpen = signal(false);
  protected columnEdit = signal<{ id: string | null; title: string; color: string; description: string } | null>(null);
  protected form = {
    allowAnonymous: true, locked: false, themed: false,
    theme: { preset: THEME_PRESETS[0].id, tokens: { ...THEME_PRESETS[0].tokens } } as ThemePreference,
  };

  protected perm = computed(() => this.store.permissions() ?? { role: 'viewer', canWrite: false, canVote: false, canFacilitate: false });
  protected boardStyle = computed(() => {
    const t = this.store.board()?.settings.theme;
    return t ? themeStyle(t) : {};
  });

  protected saveOpen = signal(false);
  protected saveName = '';
  protected saving = signal(false);
  protected today = localDate();
  protected carryCount = computed(() => this.store.cards().filter(c => c.status === 'carry_over').length);

  openSave() {
    this.saveName = '';
    this.today = localDate();
    this.saveOpen.set(true);
  }

  async saveBoard() {
    this.saving.set(true);
    try {
      const r = await this.api.post<{ saved: BoardDto; board: BoardDto }>(`/api/boards/${this.boardId()}/save`, { name: this.saveName.trim() || undefined, date: this.today });
      this.saveOpen.set(false);
      this.toast.show(`Saved “${r.saved.title}” to the history. This is the fresh board.`);
      await this.router.navigate(['/boards', r.board.id], { replaceUrl: true });
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.saving.set(false);
    }
  }

  /** In demo mode there's no server to download from, so the file is built in the browser. */
  exportDemo(e: Event, format: 'md' | 'csv') {
    if (!this.demo.active()) return;
    e.preventDefault();
    this.demo.exportBoard(this.store.board()!.id, format);
  }

  constructor() {
    // Someone else saved the board: follow them to the fresh one.
    effect(() => {
      const next = this.store.next();
      if (!next || this.saving()) return;
      this.toast.show(`The board was saved as “${next.savedTitle}”. Moved you to the fresh board.`);
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

  onKey(e: KeyboardEvent) {
    const typing = (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]');
    if (typing) return;
    if (e.key === 'Escape') this.store.pickingGroupFor.set(null);
    if (e.key.toLowerCase() === 'g' && this.perm().canWrite) this.store.groupMode.update(v => !v);
  }

  add(columnId: string, r: ComposerResult) {
    void this.store.addCard(columnId, r.body, r.anonymous, r.attachmentIds);
  }

  drop(e: CdkDragDrop<string, string, CardDto>) {
    const card = e.item.data;
    const targetColumn = e.container.data;
    if (this.store.groupMode()) {
      const target = this.cardUnder(e.dropPoint, card.id);
      if (target) {
        void this.store.groupInto(card.id, target);
        return;
      }
      if (targetColumn === card.columnId) return;
      const list = this.store.columnCards().get(targetColumn) ?? [];
      void this.store.moveCard(card, targetColumn, list.length);
      return;
    }
    if (this.store.sort() === 'likes' && targetColumn === card.columnId) return;
    void this.store.moveCard(card, targetColumn, e.currentIndex);
  }

  /** In group mode sorting is off, so whatever card sits under the pointer is the drop target. */
  private cardUnder(point: { x: number; y: number }, exclude: string): string | null {
    for (const el of document.elementsFromPoint(point.x, point.y)) {
      if (el.closest('.cdk-drag-preview')) continue;
      const card = el.closest<HTMLElement>('[data-card-id]');
      const id = card?.dataset['cardId'];
      if (id && id !== exclude) {
        const head = this.store.cards().find(c => c.id === id);
        return head?.parentId ?? id;
      }
    }
    return null;
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
    const s = this.store.board()!.settings;
    this.form = {
      allowAnonymous: s.allowAnonymous, locked: s.locked,
      themed: !!s.theme,
      theme: s.theme ? { preset: 'custom', tokens: { ...s.theme } } : { preset: THEME_PRESETS[0].id, tokens: { ...THEME_PRESETS[0].tokens } },
    };
    this.settingsOpen.set(true);
  }

  async saveSettings() {
    await this.store.updateBoard({
      settings: {
        allowAnonymous: this.form.allowAnonymous, locked: this.form.locked,
        theme: this.form.themed ? this.form.theme.tokens : null,
      },
    });
    this.settingsOpen.set(false);
  }

  async setStatus(status: 'open' | 'closed' | 'archived') {
    await this.store.updateBoard({ status });
    this.settingsOpen.set(false);
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
