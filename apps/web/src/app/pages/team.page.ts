import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { THEME_PRESETS, type ThemePreference,
  CARD_STATUS_LABELS, type ActionItemDto, type BoardSummaryDto, type ColumnSpec, type InviteDto, type SearchResultDto,
  type TeamDto, type TeamMemberDto, type TeamRole, type TemplateDto,
} from '@retro/shared';
import { Api } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { ActionList } from '../shared/action-list';
import { ExportDialog } from '../shared/export-dialog';
import { ThemeEditor } from '../shared/theme-editor';
import { Avatar } from '../shared/avatar';
import { ColorPicker } from '../shared/color-picker';
import { Modal } from '../shared/modal';
import { RelativeTimePipe } from '../shared/relative-time.pipe';

type Tab = 'boards' | 'actions' | 'members' | 'settings';

import { TeamPhoto } from '../shared/team-photo';
@Component({
  selector: 'app-team-page',
  imports: [FormsModule, RouterLink, Modal, Avatar, ColorPicker, RelativeTimePipe, ActionList, ExportDialog, ThemeEditor, TeamPhoto],
  template: `
    @if (team(); as t) {
      <div class="page">
        <div class="page-head">
          <app-team-photo class="page-head-photo" [team]="t" [size]="56" />
          <div>
            <p class="crumbs"><a routerLink="/">Teams</a> / {{ t.name }}</p>
            <h1>History</h1>
            @if (t.description) { <p class="muted">{{ t.description }}</p> }
          </div>
          <div class="spacer"></div>
          <a class="btn primary" [routerLink]="['/teams', t.id]">Current Board</a>
          @if (auth.on('export')) { <button class="btn" type="button" (click)="openExport()">Export</button> }
          @if (canCreate()) { <button class="btn" type="button" (click)="openNewBoard()">New Board</button> }
        </div>

        <form class="search" role="search" (ngSubmit)="search()">
          <input name="q" type="search" [(ngModel)]="query" placeholder="Search every card and action in this team…" aria-label="Search team history">
        </form>
        @if (results(); as r) {
          <section class="card-surface results">
            <div class="row"><h2>Results for “{{ lastQuery() }}”</h2><div class="spacer"></div><button class="btn ghost" type="button" (click)="results.set(null)">Clear</button></div>
            @if (!r.cards.length && !r.actions.length) { <p class="muted">Nothing found.</p> }
            @for (c of r.cards; track c.card.id) {
              <a class="result" [routerLink]="['/boards', c.board.id]"><span class="pill">{{ c.board.title }}</span> {{ c.card.body }}
                @if (c.card.status !== 'none') { <span class="tag">{{ statusLabels[c.card.status] }}</span> }</a>
            }
            @for (a of r.actions; track a.id) {
              <div class="result"><span class="pill">Action</span> {{ a.title }} <span class="tag">{{ a.status }}</span></div>
            }
          </section>
        }

        <div class="tabs" role="tablist">
          @for (x of tabs(); track x.id) {
            <button role="tab" type="button" [class.active]="tab() === x.id" [attr.aria-selected]="tab() === x.id" (click)="tab.set(x.id)">{{ x.label }}</button>
          }
        </div>

        @switch (tab()) {
          @case ('boards') {
            <div class="row filters">
              @for (f of boardFilters; track f.id) {
                <button type="button" class="chip" [class.active]="boardFilter() === f.id" (click)="boardFilter.set(f.id)">{{ f.label }}</button>
              }
            </div>
            @if (!filteredBoards().length) {
              <p class="muted">No {{ boardFilter() === 'all' ? '' : boardFilter() }} boards yet.</p>
            }
            <ul class="board-list">
              @for (b of filteredBoards(); track b.id) {
                <li class="card-surface">
                  <a [routerLink]="['/boards', b.id]" class="board-link">
                    <strong>{{ b.title }}</strong>
                    <span class="status" [attr.data-status]="b.status">{{ b.status }}</span>
                  </a>
                  <span class="meta">{{ b.cardCount }} cards · {{ b.actionCount }} actions · {{ b.createdAt | ago }}
                    @if (b.createdBy) { · by {{ b.createdBy.name }} }</span>
                  @if (b.status !== 'open' && auth.on('export')) {
                    <button type="button" class="btn ghost small board-export" (click)="openExport([b.id])">Export</button>
                  }
                </li>
              }
            </ul>
          }
          @case ('actions') {
            <div class="row filters">
              @for (f of actionFilters; track f) {
                <button type="button" class="chip" [class.active]="actionFilter() === f" (click)="actionFilter.set(f)">{{ f }}</button>
              }
            </div>
            <app-action-list [actions]="filteredActions()" [members]="memberUsers()" [teamId]="t.id"
                             [canEdit]="canCreate()" [showBoard]="true" (changed)="loadActions()" />
          }
          @case ('members') {
            <section class="stack">
              <ul class="member-list">
                @for (m of members(); track m.user.id) {
                  <li [class.is-me]="m.user.id === auth.me()?.id">
                    <app-avatar [user]="m.user" />
                    <span class="grow">{{ m.user.name }} @if (m.user.id === auth.me()?.id) { <span class="me-tag">You</span> }
                      @if (m.user.email) { <span class="muted">· {{ m.user.email }}</span> }</span>
                    @if (isAdmin()) {
                      <select [ngModel]="m.role" (ngModelChange)="setRole(m, $event)" [attr.aria-label]="'Role for ' + m.user.name">
                        @for (r of roles; track r) { <option [value]="r">{{ r }}</option> }
                      </select>
                      <button class="btn ghost danger" type="button" (click)="remove(m)">Remove</button>
                    } @else {
                      <span class="tag">{{ m.role }}</span>
                      @if (m.user.id === auth.me()?.id) { <button class="btn ghost" type="button" (click)="remove(m)">Leave</button> }
                    }
                  </li>
                }
              </ul>
              <details class="help">
                <summary>What can each role do?</summary>
                <ul>
                  <li><strong>admin</strong>: everything, including members, invites, templates, closing and deleting boards</li>
                  <li><strong>member</strong>: start retros, add cards, replies and media, like cards, react, manage action items. Facilitates boards they start</li>
                  <li><strong>viewer</strong>: read-only access to boards and history</li>
                </ul>
              </details>

              @if (isAdmin()) {
                <h2>Invite People</h2>
                <form class="row wrap" (ngSubmit)="createInvite()">
                  <input name="email" type="email" [(ngModel)]="inviteEmail" placeholder="Email (optional, locks the link to one person)" class="grow">
                  <select name="role" [(ngModel)]="inviteRole" aria-label="Role">
                    @for (r of roles; track r) { <option [value]="r">{{ r }}</option> }
                  </select>
                  <button class="btn primary" type="submit">Create Invite Link</button>
                </form>
                <form class="row wrap" (ngSubmit)="addExisting()">
                  <input name="existing" type="email" [(ngModel)]="existingEmail" placeholder="Add someone who already has an account, by email" class="grow">
                  <button class="btn" type="submit" [disabled]="!existingEmail">Add</button>
                </form>
                @if (invites().length) {
                  <ul class="invite-list">
                    @for (i of invites(); track i.id) {
                      <li>
                        <code class="grow">{{ inviteUrl(i) }}</code>
                        <span class="meta">{{ i.role }} · {{ i.uses }}{{ i.maxUses ? '/' + i.maxUses : '' }} used
                          @if (i.email) { · {{ i.email }} } @if (i.expiresAt) { · expires {{ i.expiresAt | ago }} }</span>
                        <button class="btn ghost" type="button" (click)="copy(inviteUrl(i))">Copy</button>
                        <button class="btn ghost danger" type="button" (click)="revoke(i)">Revoke</button>
                      </li>
                    }
                  </ul>
                }
              }
            </section>
          }
          @case ('settings') {
            <section class="stack narrow">
              <h2>Team</h2>
              <div class="team-photo-edit">
                <app-team-photo [team]="t" [size]="72" />
                <div class="stack-tight">
                  <span class="token-label">Photo</span>
                  <div class="row wrap">
                    <label class="btn small" [class.disabled]="photoBusy()">{{ t.photoUrl ? 'Change Photo' : 'Upload Photo' }}
                      <input type="file" accept="image/*" hidden [disabled]="photoBusy()" (change)="uploadPhoto($event)"></label>
                    @if (t.photoUrl) { <button type="button" class="btn ghost small" [disabled]="photoBusy()" (click)="removePhoto()">Remove</button> }
                  </div>
                </div>
              </div>
              <label>Name <input [(ngModel)]="edit.name" maxlength="80"></label>
              <label>Description <textarea [(ngModel)]="edit.description" rows="2" maxlength="500"></textarea></label>
              <h2 id="board-settings">Boards</h2>
              <p class="muted">These apply to the team's current board and every board after it. Boards in the
                history keep the columns, colors and settings they had, so they always look as they did.</p>
              <label>Columns for new boards
                <select [(ngModel)]="edit.defaultTemplateId">
                  @for (tpl of templates(); track tpl.id) { <option [value]="tpl.id">{{ tpl.name }}</option> }
                </select>
              </label>
              @if (auth.on('anonymous')) {
                <label class="check"><input type="checkbox" [(ngModel)]="edit.allowAnonymous"> Allow anonymous cards</label>
              }
              <label class="check"><input type="checkbox" [(ngModel)]="edit.locked"> Lock boards: no new or edited cards (likes and reactions still work)</label>
              <fieldset class="stack">
                <legend>Colors</legend>
                <label class="check"><input type="checkbox" [(ngModel)]="edit.themed"> Give this team's boards their own colors (everyone sees them)</label>
                @if (edit.themed) {
                  <app-theme-editor [value]="edit.theme" (valueChange)="edit.theme = $event" [compact]="true" />
                }
              </fieldset>
              <div class="row"><button class="btn primary" type="button" (click)="saveTeam()">Save</button></div>

              <h2>Custom Templates</h2>
              <ul class="template-list">
                @for (tpl of customTemplates(); track tpl.id) {
                  <li><span class="grow"><strong>{{ tpl.name }}</strong> <span class="muted">{{ columnNames(tpl) }}</span></span>
                    <button class="btn ghost danger" type="button" (click)="deleteTemplate(tpl)">Delete</button></li>
                } @empty { <li class="muted">None yet. Build one below, or use “Save columns as template” on any board.</li> }
              </ul>
              <details>
                <summary>New Template</summary>
                <div class="stack">
                  <label>Name <input [(ngModel)]="tplName" maxlength="80"></label>
                  @for (c of tplColumns(); track $index; let i = $index) {
                    <div class="row wrap column-spec">
                      <input [ngModel]="c.title" (ngModelChange)="setTplColumn(i, { title: $event })" placeholder="Column title" class="grow">
                      <app-color-picker [value]="c.color" (valueChange)="setTplColumn(i, { color: $event })" label="Column color" />
                      <button class="btn ghost danger" type="button" (click)="removeTplColumn(i)" aria-label="Remove column">✕</button>
                    </div>
                  }
                  <div class="row">
                    <button class="btn" type="button" (click)="addTplColumn()">Add Column</button>
                    <div class="spacer"></div>
                    <button class="btn primary" type="button" (click)="saveTemplate()" [disabled]="!tplName.trim() || !tplColumns().length">Save Template</button>
                  </div>
                </div>
              </details>

              <h2 id="team-password">Password</h2>
              @if (t.password.set) {
                <p>🔒 Everyone needs the password to open this team's boards. Each browser asks once, and again after it changes.</p>
                @if (t.password.owner) {
                  <p class="notice">This browser set the password, so it can change or remove it without the old one, even if it's forgotten.</p>
                }
              } @else {
                <p class="muted">No password: anyone on the team can open its boards. With one, everyone types it once per browser.
                  The browser that sets it can always change it later, even without the old one.</p>
              }
              <form class="stack password-form" (ngSubmit)="savePassword(false)">
                <!-- for password managers: whose password this is -->
                <input type="text" name="username" [value]="t.name" autocomplete="username" hidden>
                @if (t.password.set && !t.password.owner) {
                  <label>Current password <input name="current" type="password" [(ngModel)]="pw.current" autocomplete="current-password"></label>
                }
                <label>{{ t.password.set ? 'New password' : 'Password' }}
                  <input name="next" type="password" [(ngModel)]="pw.next" autocomplete="new-password" minlength="4" maxlength="200"></label>
                <div class="row wrap">
                  <button type="submit" class="btn primary" [disabled]="pwBusy() || pw.next.length < 4 || (t.password.set && !t.password.owner && !pw.current)">
                    {{ t.password.set ? 'Change Password' : 'Set Password' }}</button>
                  @if (t.password.set) {
                    <button type="button" class="btn ghost danger" [disabled]="pwBusy() || (!t.password.owner && !pw.current)" (click)="savePassword(true)">Remove Password</button>
                  }
                </div>
                @if (t.password.set) {
                  <p class="muted small">Changing it asks everyone for the new one. Forgot it, and this isn't the browser that set it?
                    Whoever runs the server can remove it with <code>./launch.sh unlock "{{ t.name }}"</code>.</p>
                }
              </form>

              <h2 class="danger-text">Danger Zone</h2>
              <button class="btn danger" type="button" (click)="deleteTeam()">Delete Team and All Its Boards</button>
            </section>
          }
        }
      </div>

      @if (exportFor(); as pre) {
        <app-export-dialog [teamId]="t.id" [preselect]="pre" (closed)="exportFor.set(null)" />
      }
      @if (newBoardOpen()) {
        <app-modal heading="Start a Retro" [wide]="true" (closed)="newBoardOpen.set(false)">
          <form class="stack" (ngSubmit)="createBoard()">
            <label>Title <input name="title" [(ngModel)]="boardTitle" required maxlength="120"></label>
            <fieldset class="template-picker">
              <legend>Template</legend>
              @for (tpl of templates(); track tpl.id) {
                <label class="template-option" [class.selected]="boardTemplate === tpl.id">
                  <input type="radio" name="tpl" [value]="tpl.id" [(ngModel)]="boardTemplate">
                  <strong>{{ tpl.name }}</strong>
                  <span class="swatch-row">@for (c of tpl.columns; track $index) { <span class="dot" [style.background]="c.color" [title]="c.title"></span> }</span>
                  <span class="muted small">{{ tpl.description || columnNames(tpl) }}</span>
                </label>
              }
            </fieldset>
            <div class="row wrap">
              <label class="check"><input name="anon" type="checkbox" [(ngModel)]="boardAnon"> Allow anonymous cards</label>
            </div>
            <label class="check">
              <input name="carry" type="checkbox" [(ngModel)]="boardCarry">
              Carry over {{ carry().cards }} marked {{ carry().cards === 1 ? 'card' : 'cards' }} from earlier retros
            </label>
            @if (carry().openActions) { <p class="muted small">{{ carry().openActions }} open action items will show on the board too.</p> }
            <div class="row end"><button class="btn primary" type="submit" [disabled]="!boardTitle.trim()">Start Retro</button></div>
          </form>
        </app-modal>
      }
    } @else {
      <div class="page"><p class="muted">Loading…</p></div>
    }
  `,
})
export class TeamPage {
  protected auth = inject(AuthService);
  private api = inject(Api);
  private router = inject(Router);
  private toast = inject(ToastService);

  readonly teamId = input.required<string>();
  /** ?tab=settings opens that tab (Board Settings links here) */
  readonly tabParam = input<string | undefined>(undefined, { alias: 'tab' });

  protected team = signal<TeamDto | null>(null);
  protected boards = signal<BoardSummaryDto[]>([]);
  protected actions = signal<ActionItemDto[]>([]);
  protected members = signal<TeamMemberDto[]>([]);
  protected invites = signal<InviteDto[]>([]);
  protected templates = signal<TemplateDto[]>([]);
  protected carry = signal({ cards: 0, openActions: 0 });
  protected results = signal<SearchResultDto | null>(null);
  protected lastQuery = signal('');
  protected tab = signal<Tab>('boards');
  protected boardFilter = signal<'all' | 'open' | 'archived'>('all');
  protected actionFilter = signal<'open' | 'done' | 'all'>('open');
  protected newBoardOpen = signal(false);
  /** The Export popup: which boards start ticked (all of the team's history when empty) */
  protected exportFor = signal<string[] | null>(null);

  openExport(boardIds: string[] = []) {
    this.exportFor.set(boardIds);
  }

  protected statusLabels = CARD_STATUS_LABELS;
  protected roles: TeamRole[] = ['admin', 'member', 'viewer'];
  protected boardFilters = [
    { id: 'all' as const, label: 'All' }, { id: 'open' as const, label: 'Current' }, { id: 'archived' as const, label: 'Archived' },
  ];
  protected actionFilters = ['open', 'done', 'all'] as const;

  protected query = '';
  protected inviteEmail = '';
  protected inviteRole: TeamRole = 'member';
  protected existingEmail = '';
  protected edit = {
    name: '', description: '', defaultTemplateId: 'went-well', allowAnonymous: true, locked: false,
    themed: false, theme: { preset: THEME_PRESETS[0].id, tokens: { ...THEME_PRESETS[0].tokens } } as ThemePreference,
  };
  protected tplName = '';
  protected tplColumns = signal<ColumnSpec[]>([{ title: 'Went Well', color: '#22c55e' }]);
  protected boardTitle = '';
  protected boardTemplate = 'went-well';
  protected boardAnon = true;
  protected boardCarry = true;

  protected isAdmin = computed(() => this.team()?.myRole === 'admin');
  protected canCreate = computed(() => this.team()?.myRole === 'admin' || this.team()?.myRole === 'member');
  protected tabs = computed(() => [
    { id: 'boards' as Tab, label: 'Past Boards' },
    ...(this.auth.on('actions') ? [{ id: 'actions' as Tab, label: 'Action Items' }] : []),
    { id: 'members' as Tab, label: `Members (${this.members().length})` },
    ...(this.isAdmin() ? [{ id: 'settings' as Tab, label: 'Settings' }] : []),
  ]);
  protected filteredBoards = computed(() => {
    const f = this.boardFilter();
    return f === 'all' ? this.boards() : this.boards().filter(b => b.status === f);
  });
  protected filteredActions = computed(() => {
    const f = this.actionFilter();
    return f === 'all' ? this.actions() : this.actions().filter(a => a.status === f);
  });
  protected memberUsers = computed(() => this.members().map(m => m.user));
  protected customTemplates = computed(() => this.templates().filter(t => !t.builtIn));

  constructor() {
    effect(() => {
      const id = this.teamId();
      this.results.set(null);
      void this.load(id).then(() => this.auth.welcome(id));
      const want = this.tabParam();
      if (want === 'settings' || want === 'actions' || want === 'members' || want === 'boards') this.tab.set(want as Tab);
    });
  }

  private base() { return `/api/teams/${this.teamId()}`; }

  async load(id: string) {
    try {
      const team = await this.api.get<TeamDto>(`/api/teams/${id}`);
      this.team.set(team);
      document.title = `${team.name} · ${this.auth.siteName()}`;
      this.edit = {
        name: team.name, description: team.description,
        defaultTemplateId: team.settings.defaultTemplateId ?? 'went-well',
        allowAnonymous: team.settings.allowAnonymous ?? true,
        locked: !!team.settings.locked,
        themed: !!team.settings.theme,
        theme: team.settings.theme ? { preset: 'custom', tokens: team.settings.theme } : { preset: THEME_PRESETS[0].id, tokens: { ...THEME_PRESETS[0].tokens } },
      };
      const [boards, members, templates] = await Promise.all([
        this.api.get<BoardSummaryDto[]>(`${this.base()}/boards`),
        this.api.get<TeamMemberDto[]>(`${this.base()}/members`),
        this.api.get<TemplateDto[]>(`${this.base()}/templates`),
      ]);
      this.boards.set(boards);
      this.members.set(members);
      this.templates.set(templates);
      await this.loadActions();
      if (team.myRole === 'admin') this.invites.set(await this.api.get<InviteDto[]>(`${this.base()}/invites`));
    } catch (err) {
      this.toast.error(err);
      await this.router.navigateByUrl('/');
    }
  }

  async loadActions() {
    this.actions.set(await this.api.get<ActionItemDto[]>(`${this.base()}/actions`));
  }

  async openNewBoard() {
    const t = this.team()!;
    this.boardTitle = `Retro ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    this.boardTemplate = t.settings.defaultTemplateId ?? 'went-well';
    this.carry.set(await this.api.get(`${this.base()}/carry-over`));
    this.newBoardOpen.set(true);
  }

  async createBoard() {
    try {
      const b = await this.api.post<BoardSummaryDto>(`${this.base()}/boards`, {
        title: this.boardTitle,
        templateId: this.boardTemplate,
        carryOver: this.boardCarry,
        settings: { allowAnonymous: this.boardAnon },
      });
      await this.router.navigate(['/boards', b.id]);
    } catch (err) {
      this.toast.error(err);
    }
  }

  async search() {
    const q = this.query.trim();
    if (q.length < 2) return;
    try {
      this.results.set(await this.api.get<SearchResultDto>(`${this.base()}/search?q=${encodeURIComponent(q)}`));
      this.lastQuery.set(q);
    } catch (err) {
      this.toast.error(err);
    }
  }

  async setRole(m: TeamMemberDto, role: TeamRole) {
    try {
      await this.api.patch(`${this.base()}/members/${m.user.id}`, { role });
      this.toast.show(`${m.user.name} is now ${role}`);
    } catch (err) {
      this.toast.error(err);
    }
    this.members.set(await this.api.get<TeamMemberDto[]>(`${this.base()}/members`));
  }

  async remove(m: TeamMemberDto) {
    const self = m.user.id === this.auth.me()?.id;
    if (!confirm(self ? 'Leave this team?' : `Remove ${m.user.name} from the team?`)) return;
    try {
      await this.api.delete(`${this.base()}/members/${m.user.id}`);
      if (self) await this.router.navigateByUrl('/');
      else this.members.set(await this.api.get<TeamMemberDto[]>(`${this.base()}/members`));
    } catch (err) {
      this.toast.error(err);
    }
  }

  /**
   * Built from PUBLIC_URL when you're on localhost but the site is shared at another address (launch --network),
   * so the link you copy works for the people you send it to.
   */
  inviteUrl(i: InviteDto) {
    const shared = this.auth.config()?.publicUrl;
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    const base = local && shared && !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]?/.test(shared) ? shared : location.origin;
    return `${base}/invite/${i.token}`;
  }

  async createInvite() {
    try {
      const inv = await this.api.post<InviteDto>(`${this.base()}/invites`, { email: this.inviteEmail || null, role: this.inviteRole });
      this.invites.update(list => [inv, ...list]);
      this.inviteEmail = '';
      await this.copy(this.inviteUrl(inv));
    } catch (err) {
      this.toast.error(err);
    }
  }

  async addExisting() {
    try {
      await this.api.post(`${this.base()}/members`, { email: this.existingEmail, role: this.inviteRole });
      this.existingEmail = '';
      this.members.set(await this.api.get<TeamMemberDto[]>(`${this.base()}/members`));
    } catch (err) {
      this.toast.error(err);
    }
  }

  async revoke(i: InviteDto) {
    await this.api.delete(`/api/invites/${i.id}`);
    this.invites.update(list => list.filter(x => x.id !== i.id));
  }

  async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.show('Invite link copied');
    } catch {
      prompt('Copy this link', text);
    }
  }

  protected photoBusy = signal(false);

  async uploadPhoto(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.photoBusy.set(true);
    try {
      this.team.set(await this.api.upload<TeamDto>(`${this.base()}/photo`, file));
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.photoBusy.set(false);
    }
  }

  async removePhoto() {
    this.photoBusy.set(true);
    try {
      this.team.set(await this.api.delete<TeamDto>(`${this.base()}/photo`));
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.photoBusy.set(false);
    }
  }

  async saveTeam() {
    try {
      this.team.set(await this.api.patch<TeamDto>(this.base(), {
        name: this.edit.name, description: this.edit.description,
        settings: {
          defaultTemplateId: this.edit.defaultTemplateId,
          ...(this.auth.on('anonymous') ? { allowAnonymous: this.edit.allowAnonymous } : {}),
          locked: this.edit.locked,
          theme: this.edit.themed ? this.edit.theme.tokens : null,
        },
      }));
      this.toast.show('Saved');
    } catch (err) {
      this.toast.error(err);
    }
  }

  columnNames(t: TemplateDto) { return t.columns.map(c => c.title).join(' · '); }
  addTplColumn() { this.tplColumns.update(c => [...c, { title: '', color: '#3b82f6' }]); }
  removeTplColumn(i: number) { this.tplColumns.update(c => c.filter((_, j) => j !== i)); }
  setTplColumn(i: number, patch: Partial<ColumnSpec>) { this.tplColumns.update(c => c.map((x, j) => (j === i ? { ...x, ...patch } : x))); }

  async saveTemplate() {
    try {
      await this.api.post(`${this.base()}/templates`, { name: this.tplName, columns: this.tplColumns().filter(c => c.title.trim()) });
      this.templates.set(await this.api.get<TemplateDto[]>(`${this.base()}/templates`));
      this.tplName = '';
      this.toast.show('Template saved');
    } catch (err) {
      this.toast.error(err);
    }
  }

  async deleteTemplate(t: TemplateDto) {
    if (!confirm(`Delete the “${t.name}” template?`)) return;
    await this.api.delete(`/api/templates/${t.id}`);
    this.templates.update(list => list.filter(x => x.id !== t.id));
  }

  protected pw = { current: '', next: '' };
  protected pwBusy = signal(false);

  /** Sets, changes or (`remove`) removes the team password */
  async savePassword(remove: boolean) {
    const t = this.team()!;
    if (remove && !confirm(`Remove the password from ${t.name}? Anyone on the team can then open its boards.`)) return;
    this.pwBusy.set(true);
    try {
      const body = { current: this.pw.current || undefined, password: remove ? null : this.pw.next };
      this.team.set(await this.api.put<TeamDto>(`${this.base()}/password`, body));
      this.toast.show(remove ? 'Password removed' : t.password.set ? 'Password changed. Everyone else types the new one' : 'Password set');
      this.pw = { current: '', next: '' };
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.pwBusy.set(false);
    }
  }

  async deleteTeam() {
    const t = this.team()!;
    if (prompt(`This deletes every board, card and action in ${t.name}. Type the team name to confirm.`) !== t.name) return;
    await this.api.delete(this.base());
    await this.router.navigateByUrl('/');
  }
}
