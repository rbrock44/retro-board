import {
  BUILT_IN_TEMPLATES, CARD_STATUS_LABELS, CARRIED_OVER_COLUMN, RENAMED_COLUMN_TITLES, isCarriedOverColumn, sameColumnTitle, DEFAULT_BOARD_SETTINGS, REACTION_EMOJI, byPosition,
  canFacilitate, canVoteBoard, canWriteBoard, positionAfter, sanitizeTokens,
  type ActionItemDto, type AttachmentDto, type AuthConfigDto, type BoardAccess, type BoardDto, type BoardEvent,
  type BoardStateDto, type BoardSummaryDto, type CardDto, type InviteDto, type MeDto, type ReactionSummary,
  type InstanceSettings, type InstanceSettingsAdminDto, type ReplyDto, type SearchResultDto, type TeamDto, type TeamMemberDto, type TeamRole, type TemplateDto, type UserDto,
} from '@retro/shared';
import { ApiError } from '../core/api.service';
import { DEMO_ME, newId, seedDemo, type DemoCard, type DemoState } from './demo-data';

type Listener = { onEvent(e: BoardEvent): void; onTyping(t: { user: UserDto; columnId: string }): void };

const fail = (status: number, msg: string): never => { throw new ApiError(status, msg); };
const notFound = (what = 'That') => fail(404, `${what} was not found`);
const nowIso = () => new Date().toISOString();

/** What the pretend teammates write while you watch a live board. */
const BOT_CARDS: [string, string][] = [
  ['Went Well', 'The new dashboards made the incident way easier to follow'],
  ['To Improve', 'PR descriptions are getting thin again'],
  ['Action Ideas', 'Rotate who runs the retro each sprint'],
  ['Went Well', 'Design and eng synced early on the billing flow'],
  ['Action Ideas', 'Pork tenderloin lunch when we ship on time 🐷'],
  ['To Improve', 'Too many Slack pings during focus time'],
];
const BOT_REPLIES = ['Ope, +1, felt this too', 'Agreed. Can we pick an owner?', 'This came up last sprint as well', 'Love it'];

/**
 * An in-browser stand-in for the API, used when there's no server (the public demo) or when asked for.
 * It answers the same URLs with the same shapes, enforces the same board rules, and plays the realtime events
 * back to the open board. State is saved by the caller (DemoService) after every change.
 */
export class DemoBackend {
  private listeners = new Map<string, Set<Listener>>();
  private bot: ReturnType<typeof setInterval> | null = null;

  constructor(public state: DemoState, private onChange: () => void) {
    // Demos saved before column titles were Title Case: bring the built-in ones up to date.
    for (const c of state.columns) c.title = RENAMED_COLUMN_TITLES[c.title] ?? c.title;
  }

  static fresh(onChange: () => void) {
    return new DemoBackend(seedDemo(), onChange);
  }

  // ---------------------------------------------------------------- lookups

  private user(id: string | null): UserDto | null {
    const u = this.state.users.find(x => x.id === id);
    return u ? { id: u.id, name: u.name, email: null, avatarUrl: u.avatarUrl, role: u.role, guest: true } : null;
  }
  private get me() { return this.state.users.find(u => u.id === this.state.meId)!; }
  private team(id: string) { return this.state.teams.find(t => t.id === id) ?? notFound('Team'); }
  private board(id: string) { return this.state.boards.find(b => b.id === id) ?? notFound('Board'); }
  private card(id: string) { return this.state.cards.find(c => c.id === id) ?? notFound('Card'); }
  private role(teamId: string, userId = this.state.meId): TeamRole | null {
    return this.state.members.find(m => m.teamId === teamId && m.userId === userId)?.role ?? null;
  }

  private requireTeam(teamId: string, min: TeamRole = 'viewer') {
    const team = this.team(teamId);
    const role = this.role(teamId) ?? notFound('Team');
    const rank = { viewer: 1, member: 2, admin: 3 };
    if (rank[role] < rank[min]) fail(403, `Team ${min}s only`);
    return { team, role };
  }

  private access(boardId: string) {
    const board = this.board(boardId);
    const role = this.role(board.teamId) ?? notFound('Board');
    const a: BoardAccess = { role, isCreator: board.createdBy === this.state.meId, status: board.status, locked: board.settings.locked };
    return { board, role, a, canWrite: canWriteBoard(a), canVote: canVoteBoard(a), canFacilitate: canFacilitate(a) };
  }

  private requireBoard(boardId: string, need: 'read' | 'write' | 'vote' | 'facilitate' | 'admin') {
    const ctx = this.access(boardId);
    const ok = need === 'read' || (need === 'write' && ctx.canWrite) || (need === 'vote' && ctx.canVote) ||
      (need === 'facilitate' && ctx.canFacilitate) || (need === 'admin' && ctx.role === 'admin');
    if (!ok) {
      if (ctx.board.status !== 'open') fail(403, 'This board is closed');
      if (ctx.board.settings.locked && need === 'write') fail(403, 'This board is locked');
      fail(403, 'Not allowed');
    }
    return ctx;
  }

  // ---------------------------------------------------------------- DTOs

  private meDto(): MeDto {
    const u = this.me;
    return {
      id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl, role: u.role,
      prefs: this.state.prefs, identities: [], hasPassword: false, guest: true, needsName: !u.name,
    };
  }

  private teamDto(t: DemoState['teams'][number]): TeamDto {
    return {
      id: t.id, name: t.name, description: t.description, createdAt: t.createdAt,
      // Only the settings teams still have (a demo saved by an older version may carry vote limits).
      settings: { defaultTemplateId: t.settings.defaultTemplateId, anonymousByDefault: t.settings.anonymousByDefault },
      myRole: this.role(t.id), memberCount: this.state.members.filter(m => m.teamId === t.id).length,
    };
  }

  private boardDto(b: DemoState['boards'][number]): BoardDto {
    return {
      id: b.id, teamId: b.teamId, title: b.title, status: b.status, createdAt: b.createdAt, closedAt: b.closedAt,
      createdBy: this.user(b.createdBy),
      settings: { allowAnonymous: b.settings.allowAnonymous, locked: b.settings.locked, theme: b.settings.theme ?? null },
      cardCount: this.state.cards.filter(c => c.boardId === b.id).length,
      actionCount: this.state.actions.filter(a => a.boardId === b.id).length,
    };
  }

  private summary(b: DemoState['boards'][number]): BoardSummaryDto {
    const { settings: _settings, ...rest } = this.boardDto(b);
    return rest;
  }

  private reactionsFor(targetType: 'card' | 'reply', targetId: string): ReactionSummary[] {
    const map = new Map<string, ReactionSummary>();
    for (const r of this.state.reactions) {
      if (r.targetType !== targetType || r.targetId !== targetId) continue;
      const s = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, users: [] };
      s.count++;
      s.mine ||= r.userId === this.state.meId;
      s.users.push(this.user(r.userId)?.name ?? 'Someone');
      map.set(r.emoji, s);
    }
    return [...map.values()];
  }

  private attachmentsFor(ids: string[]): AttachmentDto[] {
    return ids.map(id => this.state.attachments[id]).filter(Boolean);
  }

  private replyDto(r: DemoState['replies'][number]): ReplyDto {
    return {
      id: r.id, cardId: r.cardId, parentId: r.parentId, author: this.user(r.authorId), mine: r.authorId === this.state.meId,
      body: r.body, attachments: this.attachmentsFor(r.attachmentIds), reactions: this.reactionsFor('reply', r.id),
      createdAt: r.createdAt, editedAt: r.editedAt,
    };
  }

  private cardDto(c: DemoCard): CardDto {
    const likes = this.state.votes.filter(v => v.cardId === c.id);
    const from = c.carriedFromId ? this.state.cards.find(x => x.id === c.carriedFromId) : null;
    const fromBoard = from ? this.state.boards.find(b => b.id === from.boardId) : null;
    return {
      id: c.id, boardId: c.boardId, columnId: c.columnId, parentId: c.parentId, groupTitle: c.groupTitle,
      position: c.position, body: c.body, anonymous: c.anonymous,
      author: c.anonymous && c.authorId !== this.state.meId ? null : this.user(c.authorId),
      mine: c.authorId === this.state.meId, status: c.status,
      likes: likes.length,
      liked: likes.some(v => v.userId === this.state.meId),
      attachments: this.attachmentsFor(c.attachmentIds),
      reactions: this.reactionsFor('card', c.id),
      replies: this.state.replies.filter(r => r.cardId === c.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(r => this.replyDto(r)),
      carriedFrom: from && fromBoard ? { cardId: from.id, boardId: fromBoard.id, boardTitle: fromBoard.title } : null,
      createdAt: c.createdAt, editedAt: c.editedAt,
    };
  }

  private actionDto(a: DemoState['actions'][number]): ActionItemDto {
    return {
      id: a.id, teamId: a.teamId, boardId: a.boardId, cardId: a.cardId, title: a.title, owner: this.user(a.ownerId),
      dueDate: a.dueDate, status: a.status, createdAt: a.createdAt, completedAt: a.completedAt,
      boardTitle: a.boardId ? this.state.boards.find(b => b.id === a.boardId)?.title ?? null : null,
    };
  }

  private teamActions(teamId: string) {
    return this.state.actions.filter(a => a.teamId === teamId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(a => this.actionDto(a));
  }

  /** One like per person per card, like the server's `votes` table. */
  private like(boardId: string, cardId: string, userId: string): boolean {
    if (this.state.votes.some(v => v.cardId === cardId && v.userId === userId)) return false;
    this.state.votes.push({ boardId, cardId, userId, count: 1 });
    return true;
  }

  private templates(teamId: string): TemplateDto[] {
    return [
      ...this.state.templates.filter(t => t.teamId === teamId).map(({ teamId: _t, ...t }) => t),
      ...this.instanceTemplates(),
      ...BUILT_IN_TEMPLATES,
    ];
  }

  private instanceTemplates(): TemplateDto[] {
    return this.state.templates.filter(t => t.teamId === '*').map(({ teamId: _t, ...t }) => ({ ...t, instance: true }));
  }

  private static readonly SITE_DEFAULTS: InstanceSettings = {
    siteName: 'Retro Board', theme: null, defaultTemplateId: 'went-well',
    allowAnonymous: true, signup: 'open',
  };

  private site(): InstanceSettings {
    // Only known keys: a demo saved by an older version may carry settings that are gone.
    const saved = Object.entries(this.state.site ?? {}).filter(([k]) => k in DemoBackend.SITE_DEFAULTS);
    return { ...DemoBackend.SITE_DEFAULTS, ...Object.fromEntries(saved) };
  }

  private siteAdminDto(): InstanceSettingsAdminDto {
    return {
      settings: this.site(),
      launchDefaults: DemoBackend.SITE_DEFAULTS,
      overridden: Object.keys(this.state.site ?? {}) as (keyof InstanceSettings)[],
      templates: [...this.instanceTemplates(), ...BUILT_IN_TEMPLATES],
      storage: { location: 'this browser (the demo has no server)', database: 'this browser', uploads: 'this browser' },
    };
  }

  // ---------------------------------------------------------------- realtime

  subscribe(boardId: string, listener: Listener): () => void {
    const set = this.listeners.get(boardId) ?? new Set();
    set.add(listener);
    this.listeners.set(boardId, set);
    queueMicrotask(() => this.emit(boardId, { type: 'presence', users: this.presence(boardId) }));
    this.startBot();
    return () => {
      set.delete(listener);
      if (![...this.listeners.values()].some(s => s.size)) this.stopBot();
    };
  }

  private presence(boardId: string): UserDto[] {
    const board = this.state.boards.find(b => b.id === boardId);
    if (!board) return [];
    const others = this.state.members.filter(m => m.teamId === board.teamId && m.userId !== this.state.meId && m.role !== 'viewer')
      .slice(0, board.status === 'open' ? 3 : 0).map(m => this.user(m.userId)!);
    return [this.user(this.state.meId)!, ...others];
  }

  private emit(boardId: string, e: BoardEvent) {
    for (const l of this.listeners.get(boardId) ?? []) l.onEvent(e);
  }

  private emitCards(boardId: string, ids: (string | null)[]) {
    for (const id of new Set(ids)) {
      const c = id && this.state.cards.find(x => x.id === id);
      if (c) this.emit(boardId, { type: 'card.upsert', card: this.cardDto(c) });
    }
  }

  private emitBoard(boardId: string) {
    this.emit(boardId, { type: 'board.update', board: this.boardDto(this.board(boardId)) });
  }

  private emitAction(a: DemoState['actions'][number]) {
    const dto = this.actionDto(a);
    for (const b of this.state.boards.filter(x => x.teamId === a.teamId)) this.emit(b.id, { type: 'action.upsert', action: dto });
  }

  /** Pretend teammates: every so often someone on an open board likes a card, reacts, replies or adds a card. */
  private startBot() {
    if (this.bot) return;
    this.bot = setInterval(() => this.botTurn(), 9000 + Math.random() * 6000);
  }
  private stopBot() {
    if (this.bot) clearInterval(this.bot);
    this.bot = null;
  }

  private botTurn() {
    const boardId = [...this.listeners.entries()].find(([, s]) => s.size)?.[0];
    if (!boardId) return;
    const board = this.state.boards.find(b => b.id === boardId);
    if (!board || board.status !== 'open') return;
    const crew = this.presence(boardId).filter(u => u.id !== this.state.meId);
    if (!crew.length) return;
    const who = crew[Math.floor(Math.random() * crew.length)];
    const cards = this.state.cards.filter(c => c.boardId === boardId);
    const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
    const roll = Math.random();

    if (roll < 0.15 && this.state.botCards < BOT_CARDS.length && !board.settings.locked) {
      const [colTitle, body] = BOT_CARDS[this.state.botCards];
      const col = this.state.columns.find(c => c.boardId === boardId && sameColumnTitle(c.title, colTitle)) ??
        pick(this.state.columns.filter(c => c.boardId === boardId));
      if (!col) return;
      for (const l of this.listeners.get(boardId) ?? []) l.onTyping({ user: who, columnId: col.id });
      setTimeout(() => {
        this.state.botCards++;
        const last = this.state.cards.filter(c => c.columnId === col.id && !c.parentId).sort(byPosition).at(-1);
        const c: DemoCard = {
          id: newId(), boardId, columnId: col.id, parentId: null, groupTitle: null, position: positionAfter(last?.position ?? null),
          body, anonymous: false, authorId: who.id, status: 'none', carriedFromId: null, carriedToBoardId: null,
          attachmentIds: [], createdAt: nowIso(), editedAt: null,
        };
        this.state.cards.push(c);
        this.emitCards(boardId, [c.id]);
        this.onChange();
      }, 2200);
      return;
    }
    if (!cards.length) return;
    const target = pick(cards);
    if (roll < 0.7) {
      if (!this.like(boardId, target.id, who.id)) return;
    } else if (roll < 0.9) {
      const emoji = pick(REACTION_EMOJI);
      if (this.state.reactions.some(r => r.targetId === target.id && r.userId === who.id && r.emoji === emoji)) return;
      this.state.reactions.push({ boardId, targetType: 'card', targetId: target.id, userId: who.id, emoji });
    } else {
      if (board.settings.locked) return;
      this.state.replies.push({ id: newId(), cardId: target.id, parentId: null, authorId: who.id, body: pick(BOT_REPLIES), attachmentIds: [], createdAt: nowIso(), editedAt: null });
    }
    this.emitCards(boardId, [target.id]);
    this.onChange();
  }

  // ---------------------------------------------------------------- export (no server to download from)

  exportBoard(boardId: string, format: 'md' | 'csv'): { name: string; type: string; text: string } {
    const board = this.board(boardId);
    const cols = this.state.columns.filter(c => c.boardId === boardId).sort(byPosition);
    const all = this.state.cards.filter(c => c.boardId === boardId).map(c => this.cardDto(c)).sort(byPosition);
    const actions = this.state.actions.filter(a => a.boardId === boardId).map(a => this.actionDto(a));
    const slug = board.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';
    const who = (c: CardDto) => (c.anonymous ? 'Anonymous' : c.author?.name ?? 'Someone');
    const likes = (n: number) => `${n} ${n === 1 ? 'like' : 'likes'}`;
    if (format === 'csv') {
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['column', 'group', 'card', 'author', 'likes', 'status', 'replies', 'created'].join(',')];
      for (const col of cols) {
        for (const c of all.filter(x => x.columnId === col.id)) {
          const head = c.parentId ? all.find(x => x.id === c.parentId) : null;
          lines.push([col.title, head ? head.groupTitle ?? head.body.slice(0, 40) : c.groupTitle ?? '', c.body, who(c), c.likes,
            CARD_STATUS_LABELS[c.status], c.replies.length, c.createdAt].map(esc).join(','));
        }
      }
      lines.push('', ['action', 'owner', 'due', 'status'].join(','));
      for (const a of actions) lines.push([a.title, a.owner?.name ?? '', a.dueDate ?? '', a.status].map(esc).join(','));
      return { name: `${slug}.csv`, type: 'text/csv', text: lines.join('\n') };
    }
    const md: string[] = [`# ${board.title}`, '', `_${new Date(board.createdAt).toDateString()} · ${board.status}_`, ''];
    for (const col of cols) {
      md.push(`## ${col.title}`, '');
      const heads = all.filter(c => c.columnId === col.id && !c.parentId).sort((a, b) => b.likes - a.likes);
      if (!heads.length) md.push('_No cards_', '');
      for (const h of heads) {
        const kids = all.filter(c => c.parentId === h.id);
        const tag = h.status !== 'none' ? ` \`${CARD_STATUS_LABELS[h.status]}\`` : '';
        if (kids.length) {
          md.push(`- **${h.groupTitle ?? 'Group'}** (${likes(h.likes + kids.reduce((n, k) => n + k.likes, 0))})${tag}`);
          for (const c of [h, ...kids]) md.push(`  - ${c.body.replace(/\n+/g, ' ')} — ${who(c)} (${c.likes})`);
        } else {
          md.push(`- ${h.body.replace(/\n+/g, ' ')} — ${who(h)} (${likes(h.likes)})${tag}`);
        }
        for (const r of [h, ...kids].flatMap(c => c.replies)) md.push(`  - ↳ ${r.author?.name ?? 'Someone'}: ${r.body.replace(/\n+/g, ' ')}`);
      }
      md.push('');
    }
    md.push('## Action items', '');
    if (!actions.length) md.push('_None_');
    for (const a of actions) md.push(`- [${a.status === 'done' ? 'x' : ' '}] ${a.title}${a.owner ? ` — @${a.owner.name}` : ''}${a.dueDate ? ` (due ${a.dueDate})` : ''}`);
    return { name: `${slug}.md`, type: 'text/markdown', text: md.join('\n') + '\n' };
  }

  // ---------------------------------------------------------------- uploads

  async upload(url: string, file: File, onProgress?: (f: number) => void): Promise<AttachmentDto> {
    const m = url.match(/^\/api\/boards\/([^/]+)\/attachments$/) ?? notFound();
    this.requireBoard(m[1], 'write');
    const kind = file.type.startsWith('video/') ? 'video' : file.type === 'image/gif' ? 'gif' : file.type.startsWith('image/') ? 'image' : null;
    if (!kind) fail(400, 'Only images, GIFs and videos can be attached');
    if (file.size > 25 * 1024 * 1024) fail(413, 'That file is too big (25 MB max)');
    onProgress?.(0.3);
    // Small files are kept as data URLs so they survive a reload and travel in share links; big ones (video)
    // only last for this visit.
    const url2 = file.size <= 1.5 * 1024 * 1024
      ? await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); })
      : URL.createObjectURL(file);
    const size = kind === 'video' ? { width: null, height: null } : await new Promise<{ width: number | null; height: number | null }>(res => {
      const img = new Image();
      img.onload = () => res({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => res({ width: null, height: null });
      img.src = url2;
    });
    onProgress?.(1);
    const a: AttachmentDto = { id: newId(), kind: kind!, mime: file.type, url: url2, thumbUrl: null, ...size, size: file.size, name: file.name };
    this.state.attachments[a.id] = a;
    this.onChange();
    return a;
  }

  // ---------------------------------------------------------------- the API

  async handle(method: string, rawUrl: string, body: any = {}): Promise<unknown> {
    const url = new URL(rawUrl, 'http://demo');
    const path = url.pathname;
    const q = url.searchParams;
    for (const [m, re, fn] of this.routes) {
      if (m !== method) continue;
      const match = path.match(re);
      if (match) {
        const result = fn(match.slice(1), body ?? {}, q);
        if (method !== 'GET') this.onChange();
        return structuredClone(result);
      }
    }
    return notFound();
  }

  private routes: [string, RegExp, (p: string[], body: any, q: URLSearchParams) => unknown][] = [
    // ---- auth ----
    ['GET', /^\/api\/auth\/config$/, (): AuthConfigDto => ({
      mode: 'none', publicUrl: location.origin, site: { name: this.site().siteName, theme: this.site().theme }, local: { enabled: false, signup: 'closed' }, providers: [], gifSearch: false, needsSetup: false,
    })],
    ['GET', /^\/api\/auth\/me$/, () => this.meDto()],
    ['POST', /^\/api\/auth\/guest$/, () => this.meDto()],
    ['PATCH', /^\/api\/auth\/me$/, (_p, b) => {
      if (typeof b.name === 'string' && b.name.trim()) this.me.name = b.name.trim().slice(0, 100);
      if (b.avatarUrl !== undefined) this.me.avatarUrl = b.avatarUrl || null;
      if (b.prefs && 'theme' in b.prefs) {
        if (b.prefs.theme) this.state.prefs.theme = { preset: String(b.prefs.theme.preset), tokens: sanitizeTokens(b.prefs.theme.tokens) };
        else delete this.state.prefs.theme;
      }
      return this.meDto();
    }],
    ['POST', /^\/api\/auth\/logout$/, () => undefined],
    // "Switch Person": in the demo you can be anyone on the teams
    ['POST', /^\/api\/auth\/guest\/claim$/, (_p, b) => {
      const u = this.state.users.find(x => x.id === b.userId && x.name) ?? notFound('Person');
      this.state.meId = u.id;
      return this.meDto();
    }],
    ['POST', /^\/api\/auth\/guest\/new$/, () => {
      const u = { id: newId(), name: '', email: `guest-${Date.now()}@example.com`, avatarUrl: null, role: 'user' as const };
      this.state.users.push(u);
      // New people join the teams the demo has, so there's something to look at
      for (const t of this.state.teams) this.state.members.push({ teamId: t.id, userId: u.id, role: 'member', joinedAt: nowIso() });
      this.state.meId = u.id;
      return this.meDto();
    }],

    // ---- teams ----
    ['GET', /^\/api\/teams$/, () => this.state.teams.filter(t => this.role(t.id)).sort((a, b) => a.name.localeCompare(b.name)).map(t => this.teamDto(t))],
    ['POST', /^\/api\/teams$/, (_p, b) => {
      const name = String(b.name ?? '').trim() || fail(400, 'Give the team a name');
      const t = { id: newId(), name: name.slice(0, 80), description: String(b.description ?? ''), settings: {}, createdAt: nowIso() };
      this.state.teams.push(t);
      this.state.members.push({ teamId: t.id, userId: this.state.meId, role: 'admin', joinedAt: nowIso() });
      return this.teamDto(t);
    }],
    ['GET', /^\/api\/teams\/([^/]+)$/, ([id]) => this.teamDto(this.requireTeam(id).team)],
    ['PATCH', /^\/api\/teams\/([^/]+)$/, ([id], b) => {
      const { team } = this.requireTeam(id, 'admin');
      if (b.name) team.name = String(b.name).trim().slice(0, 80);
      if (b.description !== undefined) team.description = String(b.description);
      if (b.settings) team.settings = { ...team.settings, ...b.settings };
      return this.teamDto(team);
    }],
    ['DELETE', /^\/api\/teams\/([^/]+)$/, ([id]) => {
      this.requireTeam(id, 'admin');
      const boardIds = new Set(this.state.boards.filter(b => b.teamId === id).map(b => b.id));
      this.state.teams = this.state.teams.filter(t => t.id !== id);
      this.state.members = this.state.members.filter(m => m.teamId !== id);
      this.state.boards = this.state.boards.filter(b => b.teamId !== id);
      this.state.columns = this.state.columns.filter(c => !boardIds.has(c.boardId));
      this.state.cards = this.state.cards.filter(c => !boardIds.has(c.boardId));
      this.state.actions = this.state.actions.filter(a => a.teamId !== id);
      return undefined;
    }],
    ['GET', /^\/api\/teams\/([^/]+)\/members$/, ([id]): TeamMemberDto[] => {
      const { role } = this.requireTeam(id);
      return this.state.members.filter(m => m.teamId === id).map(m => {
        const u = this.state.users.find(x => x.id === m.userId)!;
        return { user: { ...this.user(u.id)!, email: role === 'admin' ? u.email : null }, role: m.role, joinedAt: m.joinedAt };
      }).sort((a, b) => a.user.name.localeCompare(b.user.name));
    }],
    ['POST', /^\/api\/teams\/([^/]+)\/members$/, ([id], b) => {
      this.requireTeam(id, 'admin');
      const email = String(b.email ?? '').trim().toLowerCase();
      // There are no real accounts in the demo, so adding someone creates them.
      let u = this.state.users.find(x => x.email === email);
      if (!u) {
        if (!/^\S+@\S+\.\S+$/.test(email)) fail(400, 'enter a valid email');
        const name = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
        u = { id: newId(), name, email, avatarUrl: null, role: 'user' };
        this.state.users.push(u);
      }
      if (this.role(id, u.id)) fail(409, 'Already a member');
      this.state.members.push({ teamId: id, userId: u.id, role: (b.role as TeamRole) ?? 'member', joinedAt: nowIso() });
      return undefined;
    }],
    ['PATCH', /^\/api\/teams\/([^/]+)\/members\/([^/]+)$/, ([id, userId], b) => {
      this.requireTeam(id, 'admin');
      const m = this.state.members.find(x => x.teamId === id && x.userId === userId) ?? notFound('Member');
      if (m.role === 'admin' && b.role !== 'admin' && this.state.members.filter(x => x.teamId === id && x.role === 'admin').length === 1) {
        fail(400, 'A team needs at least one admin');
      }
      m.role = b.role;
      return undefined;
    }],
    ['DELETE', /^\/api\/teams\/([^/]+)\/members\/([^/]+)$/, ([id, userId]) => {
      if (userId !== this.state.meId) this.requireTeam(id, 'admin');
      this.state.members = this.state.members.filter(x => !(x.teamId === id && x.userId === userId));
      return undefined;
    }],
    ['GET', /^\/api\/teams\/([^/]+)\/invites$/, ([id]) => { this.requireTeam(id, 'admin'); return this.state.invites.filter(i => i.teamId === id); }],
    ['POST', /^\/api\/teams\/([^/]+)\/invites$/, ([id], b): InviteDto => {
      const { team } = this.requireTeam(id, 'admin');
      const days = Number(b.expiresInDays ?? 7);
      const inv: InviteDto = {
        id: newId(), token: newId().replace(/-/g, ''), teamId: id, teamName: team.name, email: b.email || null, role: b.role ?? 'member',
        expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null, maxUses: b.maxUses ?? null, uses: 0, createdAt: nowIso(),
      };
      this.state.invites.push(inv);
      return inv;
    }],
    ['DELETE', /^\/api\/invites\/([^/]+)$/, ([id]) => { this.state.invites = this.state.invites.filter(i => i.id !== id); return undefined; }],
    ['GET', /^\/api\/invites\/by-token\/([^/]+)$/, () => fail(404, 'Invite links only work on a real server, not in the demo')],
    ['GET', /^\/api\/teams\/([^/]+)\/templates$/, ([id]) => { this.requireTeam(id); return this.templates(id); }],
    ['POST', /^\/api\/teams\/([^/]+)\/templates$/, ([id], b) => {
      this.requireTeam(id, 'admin');
      const t = { id: newId(), teamId: id, name: String(b.name), description: String(b.description ?? ''), columns: b.columns ?? [], builtIn: false };
      this.state.templates.push(t);
      const { teamId: _t, ...dto } = t;
      return dto;
    }],
    ['DELETE', /^\/api\/templates\/([^/]+)$/, ([id]) => { this.state.templates = this.state.templates.filter(t => t.id !== id); return undefined; }],
    // Admin → Customize works in the demo too, saved with the rest of the demo
    ['GET', /^\/api\/admin\/settings$/, () => this.siteAdminDto()],
    ['PATCH', /^\/api\/admin\/settings$/, (_p, b) => {
      const { reset = [], ...set } = b as Partial<InstanceSettings> & { reset?: (keyof InstanceSettings)[] };
      const next: Record<string, unknown> = { ...(this.state.site ?? {}), ...set };
      for (const k of reset) delete next[k];
      this.state.site = next as Partial<InstanceSettings>;
      return this.siteAdminDto();
    }],
    ['POST', /^\/api\/admin\/templates$/, (_p, b) => {
      const t = { id: newId(), teamId: '*', name: String(b.name), description: String(b.description ?? ''), columns: b.columns ?? [], builtIn: false };
      this.state.templates.push(t);
      return { ...t, instance: true };
    }],
    ['GET', /^\/api\/teams\/([^/]+)\/boards$/, ([id], _b, q) => {
      this.requireTeam(id);
      const status = q.get('status');
      return this.state.boards.filter(b => b.teamId === id && (!status || b.status === status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(b => this.summary(b));
    }],
    ['POST', /^\/api\/teams\/([^/]+)\/boards$/, ([id], b) => this.createBoard(id, b)],
    ['POST', /^\/api\/teams\/([^/]+)\/current$/, ([id]) => this.currentBoard(id)],
    ['POST', /^\/api\/boards\/([^/]+)\/save$/, ([id], b) => this.saveBoard(id, b)],
    ['GET', /^\/api\/teams\/([^/]+)\/actions$/, ([id], _b, q) => {
      this.requireTeam(id);
      const status = q.get('status');
      return this.teamActions(id).filter(a => !status || a.status === status);
    }],
    ['POST', /^\/api\/teams\/([^/]+)\/actions$/, ([id], b) => {
      this.requireTeam(id, 'member');
      const title = String(b.title ?? '').trim() || fail(400, 'Give the action a title');
      const a = {
        id: newId(), teamId: id, boardId: b.boardId ?? null, cardId: b.cardId ?? null, title, ownerId: b.ownerId ?? null,
        dueDate: b.dueDate ?? null, status: 'open' as const, createdAt: nowIso(), completedAt: null,
      };
      this.state.actions.push(a);
      this.emitAction(a);
      return this.actionDto(a);
    }],
    ['GET', /^\/api\/teams\/([^/]+)\/carry-over$/, ([id]) => {
      this.requireTeam(id);
      const boardIds = new Set(this.state.boards.filter(b => b.teamId === id).map(b => b.id));
      return {
        cards: this.state.cards.filter(c => boardIds.has(c.boardId) && c.status === 'carry_over' && !c.carriedToBoardId).length,
        openActions: this.state.actions.filter(a => a.teamId === id && a.status === 'open').length,
      };
    }],
    ['GET', /^\/api\/teams\/([^/]+)\/search$/, ([id], _b, q): SearchResultDto => {
      this.requireTeam(id);
      const term = (q.get('q') ?? '').trim().toLowerCase();
      if (term.length < 2) fail(400, 'Search for at least 2 characters');
      const boards = new Map(this.state.boards.filter(b => b.teamId === id).map(b => [b.id, b]));
      return {
        cards: this.state.cards.filter(c => boards.has(c.boardId) && (c.body.toLowerCase().includes(term) || c.groupTitle?.toLowerCase().includes(term)))
          .slice(0, 50).map(c => ({ card: { id: c.id, body: c.body, status: c.status }, board: { id: c.boardId, title: boards.get(c.boardId)!.title } })),
        actions: this.teamActions(id).filter(a => a.title.toLowerCase().includes(term)),
      };
    }],

    // ---- boards ----
    ['GET', /^\/api\/boards\/([^/]+)$/, ([id]): BoardStateDto => {
      const ctx = this.access(id);
      const team = this.team(ctx.board.teamId);
      return {
        board: this.boardDto(ctx.board),
        team: { id: team.id, name: team.name },
        columns: this.state.columns.filter(c => c.boardId === id).sort(byPosition),
        cards: this.state.cards.filter(c => c.boardId === id).map(c => this.cardDto(c)),
        actions: this.teamActions(team.id),
        members: this.state.members.filter(m => m.teamId === team.id).map(m => this.user(m.userId)!).sort((a, b) => a.name.localeCompare(b.name)),
        permissions: { role: ctx.role, canWrite: ctx.canWrite, canVote: ctx.canVote, canFacilitate: ctx.canFacilitate },
      };
    }],
    ['PATCH', /^\/api\/boards\/([^/]+)$/, ([id], b) => {
      const { board } = this.requireBoard(id, 'facilitate');
      if (b.title) board.title = String(b.title).trim().slice(0, 120);
      if (b.status && b.status !== board.status) {
        board.status = b.status;
        board.closedAt = b.status === 'open' ? null : nowIso();
      }
      if (b.settings) board.settings = { ...DEFAULT_BOARD_SETTINGS, ...board.settings, ...b.settings };
      this.emitBoard(id);
      return this.boardDto(board);
    }],
    ['DELETE', /^\/api\/boards\/([^/]+)$/, ([id]) => {
      this.requireBoard(id, 'admin');
      this.state.boards = this.state.boards.filter(b => b.id !== id);
      this.state.columns = this.state.columns.filter(c => c.boardId !== id);
      this.state.cards = this.state.cards.filter(c => c.boardId !== id);
      return undefined;
    }],
    ['POST', /^\/api\/boards\/([^/]+)\/save-template$/, ([id], b) => {
      const { board } = this.requireBoard(id, 'admin');
      const t = {
        id: newId(), teamId: board.teamId, name: String(b.name), description: String(b.description ?? ''), builtIn: false,
        columns: this.state.columns.filter(c => c.boardId === id && !isCarriedOverColumn(c.title)).sort(byPosition)
          .map(c => ({ title: c.title, color: c.color, description: c.description })),
      };
      this.state.templates.push(t);
      const { teamId: _t, ...dto } = t;
      return dto;
    }],
    ['POST', /^\/api\/boards\/([^/]+)\/columns$/, ([id], b) => {
      this.requireBoard(id, 'facilitate');
      const last = this.state.columns.filter(c => c.boardId === id).sort(byPosition).at(-1);
      const col = { id: newId(), boardId: id, title: String(b.title).trim().slice(0, 80), color: b.color, description: b.description ?? '', position: positionAfter(last?.position ?? null) };
      this.state.columns.push(col);
      this.emit(id, { type: 'column.upsert', column: col });
      return col;
    }],
    ['PATCH', /^\/api\/columns\/([^/]+)$/, ([id], b) => {
      const col = this.state.columns.find(c => c.id === id) ?? notFound('Column');
      this.requireBoard(col.boardId, 'facilitate');
      Object.assign(col, Object.fromEntries(Object.entries(b).filter(([k, v]) => ['title', 'color', 'description', 'position'].includes(k) && v !== undefined)));
      this.emit(col.boardId, { type: 'column.upsert', column: col });
      return col;
    }],
    ['DELETE', /^\/api\/columns\/([^/]+)$/, ([id]) => {
      const col = this.state.columns.find(c => c.id === id) ?? notFound('Column');
      this.requireBoard(col.boardId, 'facilitate');
      const gone = this.state.cards.filter(c => c.columnId === id).map(c => c.id);
      this.state.cards = this.state.cards.filter(c => c.columnId !== id);
      this.state.columns = this.state.columns.filter(c => c.id !== id);
      for (const cid of gone) this.emit(col.boardId, { type: 'card.delete', id: cid });
      this.emit(col.boardId, { type: 'column.delete', id });
      return undefined;
    }],

    // ---- cards ----
    ['POST', /^\/api\/boards\/([^/]+)\/cards$/, ([id], b) => {
      const { board } = this.requireBoard(id, 'write');
      const col = this.state.columns.find(c => c.id === b.columnId && c.boardId === id) ?? notFound('Column');
      const ids: string[] = b.attachmentIds ?? [];
      if (!String(b.body ?? '').trim() && !ids.length) fail(400, 'A card needs text or an attachment');
      if (b.anonymous && !board.settings.allowAnonymous) fail(403, 'Anonymous cards are turned off on this board');
      const last = this.state.cards.filter(c => c.columnId === col.id && !c.parentId).sort(byPosition).at(-1);
      const c: DemoCard = {
        id: newId(), boardId: id, columnId: col.id, parentId: null, groupTitle: null, position: positionAfter(last?.position ?? null),
        body: String(b.body ?? '').trim(), anonymous: !!b.anonymous, authorId: this.state.meId, status: 'none',
        carriedFromId: null, carriedToBoardId: null, attachmentIds: ids, createdAt: nowIso(), editedAt: null,
      };
      this.state.cards.push(c);
      this.emitCards(id, [c.id]);
      return this.cardDto(c);
    }],
    ['PATCH', /^\/api\/cards\/([^/]+)$/, ([id], b) => {
      const c = this.card(id);
      const content = b.body !== undefined || b.anonymous !== undefined || b.attachmentIds?.length || b.removeAttachmentIds?.length;
      const ctx = this.requireBoard(c.boardId, content ? 'write' : 'vote');
      if (content && !ctx.canFacilitate && c.authorId !== this.state.meId) fail(403, 'Only the author can edit this card');
      if (b.body !== undefined) { c.body = String(b.body).trim(); c.editedAt = nowIso(); }
      if (b.anonymous !== undefined) c.anonymous = !!b.anonymous;
      if (b.status) c.status = b.status;
      if (b.groupTitle !== undefined) c.groupTitle = b.groupTitle || null;
      if (b.attachmentIds?.length) c.attachmentIds.push(...b.attachmentIds);
      if (b.removeAttachmentIds?.length) c.attachmentIds = c.attachmentIds.filter(x => !b.removeAttachmentIds.includes(x));
      this.emitCards(c.boardId, [c.id]);
      return { ok: true };
    }],
    ['POST', /^\/api\/cards\/([^/]+)\/move$/, ([id], b) => {
      const c = this.card(id);
      this.requireBoard(c.boardId, 'write');
      const col = this.state.columns.find(x => x.id === b.columnId && x.boardId === c.boardId) ?? notFound('Column');
      c.columnId = col.id; c.position = b.position; c.parentId = null;
      const kids = this.state.cards.filter(k => k.parentId === c.id);
      for (const k of kids) k.columnId = col.id;
      this.emitCards(c.boardId, [c.id, ...kids.map(k => k.id)]);
      return { ok: true };
    }],
    ['POST', /^\/api\/cards\/([^/]+)\/group$/, ([id], b) => {
      const c = this.card(id);
      this.requireBoard(c.boardId, 'write');
      const target = this.card(b.targetId);
      if (target.boardId !== c.boardId) fail(400, 'Cards are on different boards');
      const head = target.parentId ? this.card(target.parentId) : target;
      if (head.id === c.id) return { ok: true };
      const moved = this.state.cards.filter(x => x.id === c.id || x.parentId === c.id);
      for (const m of moved) { m.parentId = head.id; m.columnId = head.columnId; }
      this.emitCards(c.boardId, [head.id, ...moved.map(m => m.id)]);
      return { ok: true };
    }],
    ['POST', /^\/api\/cards\/([^/]+)\/ungroup$/, ([id]) => {
      const c = this.card(id);
      this.requireBoard(c.boardId, 'write');
      if (c.parentId) {
        const old = c.parentId;
        const last = this.state.cards.filter(x => x.columnId === c.columnId && !x.parentId).sort(byPosition).at(-1);
        c.parentId = null; c.position = positionAfter(last?.position ?? null);
        this.emitCards(c.boardId, [c.id, old]);
      } else {
        const kids = this.state.cards.filter(x => x.parentId === c.id);
        for (const k of kids) k.parentId = null;
        c.groupTitle = null;
        this.emitCards(c.boardId, [c.id, ...kids.map(k => k.id)]);
      }
      return { ok: true };
    }],
    ['DELETE', /^\/api\/cards\/([^/]+)$/, ([id]) => {
      const c = this.card(id);
      const ctx = this.requireBoard(c.boardId, 'write');
      if (!ctx.canFacilitate && c.authorId !== this.state.meId) fail(403, 'Only the author can delete this card');
      const kids = this.state.cards.filter(x => x.parentId === c.id);
      for (const k of kids) k.parentId = null;
      this.state.cards = this.state.cards.filter(x => x.id !== id);
      this.state.replies = this.state.replies.filter(r => r.cardId !== id);
      this.state.votes = this.state.votes.filter(v => v.cardId !== id);
      this.emit(c.boardId, { type: 'card.delete', id });
      this.emitCards(c.boardId, kids.map(k => k.id));
      return undefined;
    }],
    ['POST', /^\/api\/cards\/([^/]+)\/vote$/, ([id]) => {
      const c = this.card(id);
      const { board } = this.requireBoard(c.boardId, 'vote');
      this.like(board.id, id, this.state.meId);
      this.emitCards(board.id, [id]);
      return { ok: true };
    }],
    ['DELETE', /^\/api\/cards\/([^/]+)\/vote$/, ([id]) => {
      const c = this.card(id);
      const { board } = this.requireBoard(c.boardId, 'vote');
      this.state.votes = this.state.votes.filter(v => !(v.cardId === id && v.userId === this.state.meId));
      this.emitCards(board.id, [id]);
      return { ok: true };
    }],
    ['POST', /^\/api\/reactions$/, (_p, b) => {
      const cardId = b.targetType === 'card' ? b.targetId : (this.state.replies.find(r => r.id === b.targetId) ?? notFound('Reply')).cardId;
      const c = this.card(cardId);
      this.requireBoard(c.boardId, 'vote');
      const i = this.state.reactions.findIndex(r => r.targetType === b.targetType && r.targetId === b.targetId && r.userId === this.state.meId && r.emoji === b.emoji);
      if (i >= 0) this.state.reactions.splice(i, 1);
      else this.state.reactions.push({ boardId: c.boardId, targetType: b.targetType, targetId: b.targetId, userId: this.state.meId, emoji: b.emoji });
      this.emitCards(c.boardId, [c.id]);
      return { active: i < 0 };
    }],
    ['POST', /^\/api\/cards\/([^/]+)\/replies$/, ([id], b) => {
      const c = this.card(id);
      this.requireBoard(c.boardId, 'write');
      const ids: string[] = b.attachmentIds ?? [];
      if (!String(b.body ?? '').trim() && !ids.length) fail(400, 'A reply needs text or an attachment');
      let parentId: string | null = null;
      if (b.parentId) {
        const parent = this.state.replies.find(r => r.id === b.parentId && r.cardId === id) ?? notFound('Reply');
        parentId = parent.parentId ?? parent.id;
      }
      const r = { id: newId(), cardId: id, parentId, authorId: this.state.meId, body: String(b.body ?? '').trim(), attachmentIds: ids, createdAt: nowIso(), editedAt: null };
      this.state.replies.push(r);
      this.emitCards(c.boardId, [id]);
      return this.replyDto(r);
    }],
    ['PATCH', /^\/api\/replies\/([^/]+)$/, ([id], b) => {
      const r = this.state.replies.find(x => x.id === id) ?? notFound('Reply');
      const c = this.card(r.cardId);
      const ctx = this.requireBoard(c.boardId, 'write');
      if (!ctx.canFacilitate && r.authorId !== this.state.meId) fail(403, 'Only the author can edit this reply');
      r.body = String(b.body ?? '').trim(); r.editedAt = nowIso();
      this.emitCards(c.boardId, [c.id]);
      return { ok: true };
    }],
    ['DELETE', /^\/api\/replies\/([^/]+)$/, ([id]) => {
      const r = this.state.replies.find(x => x.id === id) ?? notFound('Reply');
      const c = this.card(r.cardId);
      const ctx = this.requireBoard(c.boardId, 'write');
      if (!ctx.canFacilitate && r.authorId !== this.state.meId) fail(403, 'Only the author can delete this reply');
      this.state.replies = this.state.replies.filter(x => x.id !== id && x.parentId !== id);
      this.emitCards(c.boardId, [c.id]);
      return undefined;
    }],

    // ---- actions ----
    ['PATCH', /^\/api\/actions\/([^/]+)$/, ([id], b) => {
      const a = this.state.actions.find(x => x.id === id) ?? notFound('Action');
      this.requireTeam(a.teamId, 'member');
      if (b.title !== undefined) a.title = String(b.title).trim();
      if (b.ownerId !== undefined) a.ownerId = b.ownerId;
      if (b.dueDate !== undefined) a.dueDate = b.dueDate;
      if (b.status && b.status !== a.status) { a.status = b.status; a.completedAt = b.status === 'done' ? nowIso() : null; }
      this.emitAction(a);
      return this.actionDto(a);
    }],
    ['DELETE', /^\/api\/actions\/([^/]+)$/, ([id]) => {
      const a = this.state.actions.find(x => x.id === id) ?? notFound('Action');
      this.requireTeam(a.teamId, 'member');
      this.state.actions = this.state.actions.filter(x => x.id !== id);
      for (const b of this.state.boards.filter(x => x.teamId === a.teamId)) this.emit(b.id, { type: 'action.delete', id });
      return undefined;
    }],

    // ---- media ----
    ['POST', /^\/api\/boards\/([^/]+)\/attachments\/gif$/, () => fail(404, 'GIF search is off in the demo')],
    ['DELETE', /^\/api\/attachments\/([^/]+)$/, ([id]) => { delete this.state.attachments[id]; return undefined; }],
    ['GET', /^\/api\/gifs$/, () => fail(404, 'GIF search is off in the demo')],

    // ---- admin ----
    ['GET', /^\/api\/admin\/users$/, () => this.state.users.map(u => ({ ...this.user(u.id)!, email: u.email, disabled: false, createdAt: this.state.teams[0]?.createdAt ?? nowIso() }))],
    ['PATCH', /^\/api\/admin\/users\/([^/]+)$/, ([id], b) => {
      const u = this.state.users.find(x => x.id === id) ?? notFound('User');
      if (id === this.state.meId && b.role === 'user') fail(400, "You can't remove your own admin role in the demo");
      if (b.role) u.role = b.role;
      return undefined;
    }],
  ];

  /** Mirrors the server: columns from a template, plus a "Carried Over" column for cards marked to carry over. */
  private createBoard(teamId: string, b: any): BoardDto {
    const { team } = this.requireTeam(teamId, 'member');
    const title = String(b.title ?? '').trim() || fail(400, 'Give the retro a title');
    const site = this.site();
    const templateId = b.templateId ?? team.settings.defaultTemplateId ?? site.defaultTemplateId;
    const specs = b.columns?.length ? b.columns : this.templates(teamId).find(t => t.id === templateId)?.columns ?? fail(400, 'Unknown template');
    const board = {
      id: newId(), teamId, title: title.slice(0, 120), status: 'open' as const, createdAt: nowIso(), closedAt: null, createdBy: this.state.meId,
      settings: {
        ...DEFAULT_BOARD_SETTINGS,
        allowAnonymous: site.allowAnonymous,
        ...(b.settings ?? {}),
      },
    };
    this.state.boards.push(board);
    const carriedPos = positionAfter(null);
    let pos = carriedPos;
    for (const spec of specs) {
      pos = positionAfter(pos);
      this.state.columns.push({ id: newId(), boardId: board.id, title: spec.title, color: spec.color, description: spec.description ?? '', position: pos });
    }
    if (b.carryOver !== false) this.carryPending(teamId, board.id, carriedPos, false);
    return this.boardDto(board);
  }

  /** Same as the server: marked cards move once, into the same-named column when `matchColumns`. */
  private carryPending(teamId: string, boardId: string, carriedPos: string, matchColumns: boolean) {
    const boardIds = new Set(this.state.boards.filter(x => x.teamId === teamId && x.id !== boardId).map(x => x.id));
    const pending = this.state.cards.filter(c => boardIds.has(c.boardId) && c.status === 'carry_over' && !c.carriedToBoardId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!pending.length) return;
    const targets = new Map(matchColumns ? this.state.columns.filter(c => c.boardId === boardId).map(c => [c.title.trim().toLowerCase(), c.id]) : []);
    let carriedColumnId: string | null = null;
    const lastPos = new Map<string, string | null>();
    for (const orig of pending) {
      const fromTitle = this.state.columns.find(c => c.id === orig.columnId)?.title ?? '';
      let columnId = !isCarriedOverColumn(fromTitle) ? targets.get(fromTitle.trim().toLowerCase()) : undefined;
      if (!columnId) {
        if (!carriedColumnId) {
          carriedColumnId = newId();
          this.state.columns.push({ id: carriedColumnId, boardId, ...CARRIED_OVER_COLUMN, description: 'Marked to carry over from earlier retros', position: carriedPos });
        }
        columnId = carriedColumnId;
      }
      const position = positionAfter(lastPos.get(columnId) ?? null);
      lastPos.set(columnId, position);
      this.state.cards.push({
        id: newId(), boardId, columnId, parentId: null, groupTitle: null, position, body: orig.body,
        anonymous: orig.anonymous, authorId: orig.authorId, status: 'none', carriedFromId: orig.id, carriedToBoardId: null,
        attachmentIds: [...orig.attachmentIds], createdAt: nowIso(), editedAt: null,
      });
      orig.carriedToBoardId = boardId;
    }
  }

  /** "Save Board": file it in the history under the date (and name), start a fresh one with the same columns. */
  private saveBoard(boardId: string, b: any) {
    const { board } = this.requireBoard(boardId, 'facilitate');
    if (board.status !== 'open') fail(400, 'This board is already in the history');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date ?? '') ? b.date : nowIso().slice(0, 10);
    const name = String(b.name ?? '').trim().slice(0, 80);
    board.title = name ? `${date} · ${name}` : date;
    board.status = 'closed';
    board.closedAt = nowIso();
    const next = {
      id: newId(), teamId: board.teamId, title: 'Current retro', status: 'open' as const, createdAt: nowIso(), closedAt: null,
      createdBy: this.state.meId, settings: { ...board.settings, locked: false },
    };
    this.state.boards.push(next);
    const carriedPos = positionAfter(null);
    let pos = carriedPos;
    for (const c of this.state.columns.filter(c => c.boardId === boardId && !isCarriedOverColumn(c.title)).sort(byPosition)) {
      pos = positionAfter(pos);
      this.state.columns.push({ id: newId(), boardId: next.id, title: c.title, color: c.color, description: c.description, position: pos });
    }
    this.carryPending(board.teamId, next.id, carriedPos, true);
    this.emitBoard(boardId);
    this.emit(boardId, { type: 'board.next', boardId: next.id, savedTitle: board.title });
    return { saved: this.boardDto(board), board: this.boardDto(next) };
  }

  /** Opening a team: its newest open board, or a new one from the default template. */
  private currentBoard(teamId: string) {
    const { team, role } = this.requireTeam(teamId);
    const open = this.state.boards.filter(b => b.teamId === teamId && b.status === 'open').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (open) return { boardId: open.id };
    if (role === 'viewer') return { boardId: null };
    const created = this.createBoard(teamId, { title: 'Current retro', templateId: team.settings.defaultTemplateId, carryOver: false });
    const carriedPos = positionAfter(null);
    this.carryPending(teamId, created.id, carriedPos, true);
    return { boardId: created.id };
  }
}

export { DEMO_ME };
