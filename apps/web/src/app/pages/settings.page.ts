import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ThemePreference } from '@retro/shared';
import { Api } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ThemeService } from '../core/theme.service';
import { ToastService } from '../core/toast.service';
import { Avatar } from '../shared/avatar';
import { ThemeEditor } from '../shared/theme-editor';
import { ExportDialog } from '../shared/export-dialog';

@Component({
  selector: 'app-settings-page',
  imports: [FormsModule, Avatar, ThemeEditor, ExportDialog],
  template: `
    @if (auth.me(); as me) {
      <div class="page narrow stack">
        <h1>Settings</h1>

        <section class="card-surface stack">
          <h2>Profile</h2>
          <div class="row"><app-avatar [user]="me" [size]="48" /><div><strong>{{ me.name }}</strong><br><span class="muted">{{ me.email }}</span></div></div>
          <label>Display name <input [(ngModel)]="name" maxlength="100"></label>
          <label>Avatar URL <input [(ngModel)]="avatarUrl" type="url" placeholder="https://…"></label>
          <div class="row"><button class="btn primary" type="button" (click)="saveProfile()">Save Profile</button></div>
        </section>

        <section class="card-surface stack">
          <div class="row"><h2>Theme</h2><div class="spacer"></div>
            <button class="btn ghost" type="button" (click)="followSystem()">Follow System Light/Dark</button></div>
          <p class="muted">Changes apply right away and follow you to any device you sign in on.</p>
          <app-theme-editor [value]="theme.current()" (valueChange)="setTheme($event)" />
        </section>

        @if (!me.guest) {
          <section class="card-surface stack">
            <h2>Password</h2>
            @if (me.hasPassword) { <label>Current password <input type="password" [(ngModel)]="current" autocomplete="current-password"></label> }
            @else { <p class="muted">You sign in with an external provider. Set a password to also sign in with email.</p> }
            <label>New password <input type="password" [(ngModel)]="next" minlength="8" autocomplete="new-password"></label>
            <div class="row"><button class="btn" type="button" (click)="changePassword()" [disabled]="next.length < 8">{{ me.hasPassword ? 'Change Password' : 'Set Password' }}</button></div>
          </section>
        }

        @if (providers().length || me.identities.length) {
          <section class="card-surface stack">
            <h2>Linked Sign-Ins</h2>
            <ul class="member-list">
              @for (p of providers(); track p.id) {
                <li>
                  <span class="grow"><strong>{{ p.name }}</strong>
                    @if (linked(p.id); as l) { <span class="muted"> · linked{{ l.email ? ' as ' + l.email : '' }}</span> }</span>
                  @if (linked(p.id)) { <button class="btn ghost danger" type="button" (click)="unlink(p.id)">Unlink</button> }
                  @else { <button class="btn" type="button" (click)="auth.startProvider(p.id, { next: '/settings' })">Link</button> }
                </li>
              }
            </ul>
          </section>
        }

        <section class="card-surface stack">
          <h2>Export</h2>
          <p class="muted">Download past retros from any of your teams' history as one Markdown or spreadsheet file.</p>
          <div class="row"><button class="btn" type="button" (click)="exportOpen.set(true)">Export Retros…</button></div>
        </section>
      </div>
      @if (exportOpen()) { <app-export-dialog (closed)="exportOpen.set(false)" /> }
    }
  `,
})
export class SettingsPage {
  protected exportOpen = signal(false);
  protected auth = inject(AuthService);
  protected theme = inject(ThemeService);
  private api = inject(Api);
  private toast = inject(ToastService);

  protected name = this.auth.me()?.name ?? '';
  protected avatarUrl = this.auth.me()?.avatarUrl ?? '';
  protected current = '';
  protected next = '';
  protected providers = computed(() => this.auth.config()?.providers ?? []);
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = signal<ThemePreference | null>(null);

  linked(id: string) { return this.auth.me()?.identities.find(i => i.provider === id); }

  /** Applies instantly; saves to the account after the color wheel stops moving. */
  setTheme(pref: ThemePreference) {
    this.theme.set(pref);
    this.pending.set(pref);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const p = this.pending();
      if (p) void this.auth.updateMe({ prefs: { theme: p } }).catch(err => this.toast.error(err));
    }, 600);
  }

  async followSystem() {
    this.theme.resetToSystem();
    await this.auth.updateMe({ prefs: { theme: null } });
    this.toast.show('Following your system theme');
  }

  async saveProfile() {
    try {
      await this.auth.updateMe({ name: this.name, avatarUrl: this.avatarUrl || null });
      this.toast.show('Profile saved');
    } catch (err) {
      this.toast.error(err);
    }
  }

  async changePassword() {
    try {
      await this.api.post('/api/auth/password', { current: this.current || undefined, next: this.next });
      this.current = this.next = '';
      await this.auth.refresh();
      this.toast.show('Password saved');
    } catch (err) {
      this.toast.error(err);
    }
  }

  async unlink(id: string) {
    try {
      await this.api.delete(`/api/auth/identities/${id}`);
      await this.auth.refresh();
    } catch (err) {
      this.toast.error(err);
    }
  }
}
