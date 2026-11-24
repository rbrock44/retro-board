import { Injectable, computed, inject, signal } from '@angular/core';
import type { AuthConfigDto, MeDto } from '@retro/shared';
import { Api, ApiError } from './api.service';
import { ThemeService } from './theme.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(Api);
  private theme = inject(ThemeService);

  readonly me = signal<MeDto | null>(null);
  readonly config = signal<AuthConfigDto | null>(null);
  readonly loaded = signal(false);
  readonly isAdmin = computed(() => this.me()?.role === 'admin');
  /** No-sign-in mode: no accounts, everyone is a guest */
  readonly open = computed(() => this.config()?.mode === 'none');
  /** Set while the "what's your name?" dialog is showing; called with the outcome */
  readonly namePrompt = signal<((ok: boolean) => void) | null>(null);

  private loading: Promise<void> | null = null;

  /** Loads who is signed in once; guards await this before deciding. */
  ensureLoaded(): Promise<void> {
    this.loading ??= this.refresh();
    return this.loading;
  }

  async refresh(): Promise<void> {
    const [config, me] = await Promise.all([
      this.api.get<AuthConfigDto>('/api/auth/config').catch(() => null),
      this.api.get<MeDto>('/api/auth/me').catch(err => {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }),
    ]);
    this.config.set(config);
    // No sign-in: give this browser a guest identity instead of showing a login page.
    this.setMe(!me && config?.mode === 'none' ? await this.api.post<MeDto>('/api/auth/guest') : me);
    this.loaded.set(true);
  }

  /**
   * Guests give a name before their first card or reply. Resolves true once they have one, false if they
   * close the dialog.
   */
  ensureName(): Promise<boolean> {
    if (!this.me()?.needsName) return Promise.resolve(true);
    return new Promise(resolve => this.namePrompt.set(ok => { this.namePrompt.set(null); resolve(ok); }));
  }

  setMe(me: MeDto | null) {
    this.me.set(me);
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
