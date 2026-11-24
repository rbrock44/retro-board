import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-login-page',
  imports: [FormsModule],
  template: `
    <div class="auth-page">
      <div class="auth-card card-surface">
        <h1 class="brand-big"><span class="brand-mark" aria-hidden="true">◧</span> Retro Board</h1>
        @if (cfg()?.needsSetup) {
          <p class="notice">Welcome! Create the first account. It becomes the instance admin.</p>
        }
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

        @if (localEnabled()) {
          <div class="tabs" role="tablist">
            <button role="tab" type="button" [class.active]="mode() === 'login'" [attr.aria-selected]="mode() === 'login'" (click)="mode.set('login')">Sign in</button>
            @if (canSignUp()) {
              <button role="tab" type="button" [class.active]="mode() === 'signup'" [attr.aria-selected]="mode() === 'signup'" (click)="mode.set('signup')">Create account</button>
            }
          </div>
          <form class="stack" (ngSubmit)="submit()">
            @if (mode() === 'signup') {
              <label>Name <input name="name" [(ngModel)]="name" required autocomplete="name" maxlength="100"></label>
            }
            <label>Email <input name="email" type="email" [(ngModel)]="email" required autocomplete="email"></label>
            <label>Password
              <input name="password" type="password" [(ngModel)]="password" required minlength="8"
                     [autocomplete]="mode() === 'signup' ? 'new-password' : 'current-password'">
            </label>
            <button class="btn primary" type="submit" [disabled]="busy()">{{ mode() === 'login' ? 'Sign in' : 'Create account' }}</button>
          </form>
        }

        @if (cfg()?.providers?.length) {
          @if (localEnabled()) { <div class="divider"><span>or</span></div> }
          <div class="stack">
            @for (p of cfg()!.providers; track p.id) {
              <button type="button" class="btn provider" (click)="auth.startProvider(p.id, { invite: invite() ?? undefined, next: next() ?? undefined })">
                Continue with {{ p.name }}
              </button>
            }
          </div>
        }
        @if (!localEnabled() && !cfg()?.providers?.length && cfg()) {
          <p class="muted">No sign-in methods are enabled. Check <code>auth.config.yaml</code>.</p>
        }
      </div>
    </div>
  `,
})
export class LoginPage {
  protected auth = inject(AuthService);
  private router = inject(Router);

  readonly next = input<string | null>(null);
  readonly invite = input<string | null>(null);
  readonly errorParam = input<string | null>(null, { alias: 'error' });

  protected mode = signal<'login' | 'signup'>('login');
  protected busy = signal(false);
  protected failure = signal<string | null>(null);
  protected error = computed(() => this.failure() ?? this.errorParam());
  protected name = '';
  protected email = '';
  protected password = '';

  protected cfg = this.auth.config;
  protected localEnabled = computed(() => !!this.cfg()?.local.enabled || !!this.cfg()?.needsSetup);
  protected canSignUp = computed(() => {
    const c = this.cfg();
    if (!c) return false;
    return c.needsSetup || c.local.signup === 'open' || (c.local.signup === 'invite' && !!this.invite());
  });

  constructor() {
    void this.auth.ensureLoaded().then(() => {
      if (this.cfg()?.needsSetup || this.invite()) this.mode.set('signup');
    });
  }

  async submit() {
    this.busy.set(true);
    this.failure.set(null);
    try {
      if (this.mode() === 'login') await this.auth.login(this.email, this.password);
      else await this.auth.signup({ email: this.email, name: this.name, password: this.password, inviteToken: this.invite() ?? undefined });
      const dest = this.next();
      await this.router.navigateByUrl(dest && dest.startsWith('/') && !dest.startsWith('//') ? dest : '/');
    } catch (err) {
      this.failure.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
