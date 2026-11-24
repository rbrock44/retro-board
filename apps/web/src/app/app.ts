import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { ThemeService } from './core/theme.service';
import { ToastService } from './core/toast.service';
import { Avatar } from './shared/avatar';
import { ClickOutside } from './shared/click-outside';
import { NamePrompt } from './shared/name-prompt';
import { DemoBanner } from './demo/demo-banner';
import { TourOverlay } from './demo/tour-overlay';
import { DemoService } from './demo/demo.service';

@Component({
  selector: 'app-root',
  imports: [ClickOutside, RouterOutlet, RouterLink, RouterLinkActive, Avatar, NamePrompt, DemoBanner, TourOverlay],
  template: `
    <a class="skip-link" href="#main">Skip to content</a>
    @if (demo.active()) { <app-demo-banner /> }
    @if (auth.me(); as me) {
      <header class="topbar">
        <a routerLink="/" class="brand" [attr.aria-label]="auth.siteName() + ' home'">
          <span class="brand-mark" aria-hidden="true">◧</span> {{ auth.siteName() }}
        </a>
        <nav class="topnav" aria-label="Main">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Teams</a>
          @if (auth.isAdmin()) { <a routerLink="/admin" routerLinkActive="active">Admin</a> }
        </nav>
        <div class="spacer"></div>
        <button type="button" class="icon-btn" (click)="toggleDark()" [attr.aria-label]="theme.isDark() ? 'Use light theme' : 'Use dark theme'"
                [title]="theme.isDark() ? 'Light theme' : 'Dark theme'">{{ theme.isDark() ? '☀' : '☾' }}</button>
        <div class="menu-wrap" (clickOutside)="menuOpen.set(false)">
          <button type="button" class="user-btn" (click)="menuOpen.set(!menuOpen())" [attr.aria-expanded]="menuOpen()" aria-haspopup="menu">
            <app-avatar [user]="me" [size]="28" /> <span class="hide-sm">{{ me.name }}</span>
          </button>
          @if (menuOpen()) {
            <div class="menu" role="menu" (click)="menuOpen.set(false)">
              <a role="menuitem" routerLink="/settings">Profile &amp; Theme</a>
              @if (auth.isAdmin()) { <a role="menuitem" routerLink="/admin">Instance Admin</a> }
              @if (me.guest) { <button role="menuitem" type="button" (click)="auth.switchPerson()">Switch Person</button> }
              @else { <button role="menuitem" type="button" (click)="logout()">Sign Out</button> }
            </div>
          }
        </div>
      </header>
    }
    <main id="main" tabindex="-1"><router-outlet /></main>
    @if (auth.whoPrompt(); as w) { <app-name-prompt [mode]="w.mode" /> }
    @if (demo.active()) { <app-tour-overlay /> }
    <div class="toasts" aria-live="polite">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class.error]="t.kind === 'error'" (click)="toast.dismiss(t.id)">{{ t.text }}</div>
      }
    </div>
  `,
})
export class App {
  protected auth = inject(AuthService);
  protected theme = inject(ThemeService);
  protected toast = inject(ToastService);
  protected demo = inject(DemoService);
  private router = inject(Router);
  protected menuOpen = signal(false);

  constructor() {
    void this.auth.ensureLoaded().then(() => {
      // A share link has been read into this browser; take the (long) #demo=... off the address bar.
      if (location.hash.startsWith('#demo=')) void this.router.navigateByUrl(this.router.url.split('#')[0], { replaceUrl: true });
    });
  }

  async toggleDark() {
    this.theme.usePreset(this.theme.isDark() ? 'light' : 'dark');
    await this.auth.updateMe({ prefs: { theme: this.theme.current() } }).catch(() => {});
  }

  async logout() {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
