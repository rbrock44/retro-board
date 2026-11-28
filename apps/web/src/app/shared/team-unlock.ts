import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api.service';
import type { LockedTeam } from '../core/team-lock.service';
import { TeamPhoto } from './team-photo';
import { DemoService } from '../demo/demo.service';
import { takeUnlockKey } from '../core/unlock-link';

/** Shown in place of a page whose team has a password this browser hasn't typed yet. */
@Component({
  selector: 'app-team-unlock',
  imports: [FormsModule, RouterLink, TeamPhoto],
  template: `
    <div class="unlock-page">
      @if (viaLink()) {
        <p class="unlock-card card-surface muted" role="status">Opening {{ team().name }}…</p>
      } @else {
      <form class="unlock-card card-surface" (ngSubmit)="unlock()">
        <app-team-photo [team]="{ id: team().id, name: team().name, photoUrl: null }" [size]="56" />
        <h1><span aria-hidden="true">🔒</span> {{ team().name }}</h1>
        <p class="muted">This team's boards need a password. Ask a team admin for it.</p>
        @if (demo.passwordHint(team().id); as hint) {
          <p class="notice small">In this demo the password is <strong>{{ hint }}</strong>.</p>
        }
        <label>Password
          <input name="password" type="password" [(ngModel)]="password" autocomplete="current-password" autofocus
                 [attr.aria-invalid]="!!error()" aria-describedby="unlock-error"></label>
        <p id="unlock-error" class="error" role="alert">{{ error() }}</p>
        <button type="submit" class="btn primary" [disabled]="!password || busy()">{{ busy() ? 'Checking…' : 'Unlock' }}</button>
        <a routerLink="/" class="small">Back to teams</a>
      </form>
      }
    </div>
  `,
})
export class TeamUnlock implements OnInit {
  readonly team = input.required<LockedTeam>();
  /** Arrived by a link that carries the team's key: trying it before showing the prompt */
  protected viaLink = signal(false);
  private api = inject(Api);
  protected demo = inject(DemoService);
  protected password = '';
  protected busy = signal(false);
  protected error = signal('');

  async ngOnInit() {
    const key = takeUnlockKey(this.team().id);
    if (!key) return;
    this.viaLink.set(true);
    try {
      await this.api.post(`/api/teams/${this.team().id}/unlock`, { key });
      location.reload();
    } catch (err) {
      // an old link (the password changed since): ask for the password, saying why
      this.error.set(errorMessage(err));
      this.viaLink.set(false);
    }
  }

  async unlock() {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.post(`/api/teams/${this.team().id}/unlock`, { password: this.password });
      // the page underneath failed to load: start it again, now unlocked
      location.reload();
    } catch (err) {
      this.error.set(errorMessage(err));
      this.busy.set(false);
    }
  }
}
