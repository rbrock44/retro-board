import { Injectable, computed, inject, signal } from '@angular/core';
import { withFeatureDefaults, type AuthConfigDto, type FeatureKey, type MeDto, type TeamMemberDto } from '@retro/shared';

export type WhoMode = 'name' | 'switch' | 'welcome';
export interface KnownGuest { id: string; name: string; onDevice: boolean }
import { Api, ApiError } from './api.service';
import { ThemeService } from './theme.service';
import { DemoService } from '../demo/demo.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(Api);
  private theme = inject(ThemeService);
  private demo = inject(DemoService);

  readonly me = signal<MeDto | null>(null);
  readonly config = signal<AuthConfigDto | null>(null);
  readonly loaded = signal(false);
  readonly isAdmin = computed(() => this.me()?.role === 'admin');
  /** No-sign-in mode: no accounts, everyone is a guest */
  readonly open = computed(() => this.config()?.mode === 'none');
  /** The "Who are you?" dialog, while it's showing. `done` gets whether they ended up with a name. */
  readonly whoPrompt = signal<{ mode: WhoMode; done: (ok: boolean) => void } | null>(null);
  /** The team being looked at, so the dialog can offer that team's people */
  readonly teamContext = signal<string | null>(null);
  private welcomed = new Set<string>();

  private loading: Promise<void> | null = null;

  /** Loads who is signed in once; guards await this before deciding. */
  ensureLoaded(): Promise<void> {
    this.loading ??= this.refresh();
    return this.loading;
  }

  async refresh(): Promise<void> {
    // No server answering (the public demo site, or the server is down) means demo mode with sample data.
    if (!this.demo.active() && (this.demo.requested() || !(await this.serverAnswers()))) {
      await this.demo.start(this.demo.requested() ? 'asked' : 'no-server');
    }
    const [config, me] = await Promise.all([
      this.api.get<AuthConfigDto>('/api/auth/config').catch(() => null),
      this.api.get<MeDto>('/api/auth/me').catch(err => {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }),
    ]);
    this.config.set(config);
    this.theme.useSiteDefault(config?.site?.theme ?? null);
    // No sign-in: give this browser a guest identity instead of showing a login page.
    this.setMe(!me && config?.mode === 'none' ? await this.api.post<MeDto>('/api/auth/guest') : me);
    this.loaded.set(true);
  }

  /** True when /api/auth/config returns the app's JSON. Tries twice so a blip doesn't drop people into the demo. */
  private async serverAnswers(): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch('/api/auth/config', { credentials: 'same-origin' });
        if (res.ok && (await res.json())?.mode) return true;
        if (res.status === 404) return false; // a static host: no API at all
      } catch { /* unreachable */ }
      await new Promise(r => setTimeout(r, 600));
    }
    return false;
  }

  /**
   * Guests give a name before their first card or reply. Resolves true once they have one, false if they
   * close the dialog.
   */
  ensureName(): Promise<boolean> {
    if (!this.me()?.needsName) return Promise.resolve(true);
    return this.ask('name');
  }

  readonly siteName = computed(() => this.config()?.site?.name || 'Retro Board');
  /** What an admin has left switched on (Admin > Customize > Features) */
  readonly features = computed(() => withFeatureDefaults(this.config()?.site?.features));

  /** Is this feature switched on for the site? */
  on(key: FeatureKey): boolean {
    return this.features()[key];
  }

  /** "Board · Retro Board" -> "Board · <site name>" */
  withSiteName(title: string): string {
    return title.replace(/Retro Board$/, this.siteName());
  }

  /** "Switch Person" in the menu */
  switchPerson(): Promise<boolean> {
    return this.ask('switch');
  }

  /**
   * Opening a team or board as a nameless guest: if this team has people (or this device has names) to pick
   * from, ask "Are you one of these?" once per team per visit.
   */
  async welcome(teamId: string) {
    this.teamContext.set(teamId);
    if (!this.open() || !this.me()?.needsName || this.whoPrompt() || this.welcomed.has(teamId)) return;
    this.welcomed.add(teamId);
    const candidates = await this.guestCandidates(teamId).catch(() => []);
    if (candidates.length && this.me()?.needsName && !this.whoPrompt()) void this.ask('welcome');
  }

  private ask(mode: WhoMode): Promise<boolean> {
    return new Promise(resolve => this.whoPrompt.set({ mode, done: ok => { this.whoPrompt.set(null); resolve(ok); } }));
  }

  /** People to offer: names used on this device first, then the team's other guests. */
  async guestCandidates(teamId: string | null): Promise<KnownGuest[]> {
    const meId = this.me()?.id;
    const out = new Map<string, KnownGuest>();
    for (const g of this.knownGuests()) if (g.id !== meId) out.set(g.id, { ...g, onDevice: true });
    if (teamId) {
      const members = await this.api.get<TeamMemberDto[]>(`/api/teams/${teamId}/members`);
      for (const m of members) {
        if (m.user.guest && m.user.id !== meId && !out.has(m.user.id)) out.set(m.user.id, { id: m.user.id, name: m.user.name, onDevice: false });
      }
    }
    return [...out.values()];
  }

  async claimGuest(id: string) {
    this.setMe(await this.api.post<MeDto>('/api/auth/guest/claim', { userId: id }));
  }

  async newGuest() {
    this.setMe(await this.api.post<MeDto>('/api/auth/guest/new'));
  }

  forgetGuest(id: string) {
    this.saveKnown(this.knownGuests().filter(g => g.id !== id));
  }

  /** Guest names used in this browser, so "Switch Person" can offer them. Kept apart for the demo. */
  knownGuests(): KnownGuest[] {
    try {
      return JSON.parse(localStorage.getItem(this.knownKey()) ?? '[]') as KnownGuest[];
    } catch {
      return [];
    }
  }

  private knownKey() { return this.demo.active() ? 'retro-board-demo-guests' : 'retro-board-guests'; }

  private saveKnown(list: KnownGuest[]) {
    try { localStorage.setItem(this.knownKey(), JSON.stringify(list.slice(0, 20))); } catch { /* storage blocked */ }
  }

  setMe(me: MeDto | null) {
    this.me.set(me);
    if (me?.guest && !me.needsName) {
      this.saveKnown([{ id: me.id, name: me.name, onDevice: true }, ...this.knownGuests().filter(g => g.id !== me.id)]);
    }
    if (me?.prefs.theme) this.theme.adopt(me.prefs.theme);
  }

  async login(email: string, password: string) {
    this.setMe(await this.api.post<MeDto>('/api/auth/login', { email, password }));
  }

  async signup(body: { email: string; name: string; password: string; inviteToken?: string }) {
    this.setMe(await this.api.post<MeDto>('/api/auth/signup', body));
    this.config.update(c => (c ? { ...c, needsSetup: false } : c));
  }

  async logout() {
    await this.api.post('/api/auth/logout');
    this.me.set(null);
  }

  async updateMe(body: Partial<Pick<MeDto, 'name' | 'avatarUrl'>> & { prefs?: MeDto['prefs'] | { theme: null } }) {
    this.setMe(await this.api.patch<MeDto>('/api/auth/me', body));
  }

  /** Full-page redirect: OAuth needs the browser to leave the app. */
  startProvider(id: string, opts: { invite?: string; next?: string } = {}) {
    const q = new URLSearchParams();
    if (opts.invite) q.set('invite', opts.invite);
    if (opts.next) q.set('next', opts.next);
    location.href = `/api/auth/${encodeURIComponent(id)}/start${q.size ? `?${q}` : ''}`;
  }
}
