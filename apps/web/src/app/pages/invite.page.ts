import { Component, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-invite-page',
  imports: [RouterLink],
  template: `
    <div class="auth-page">
      <div class="auth-card card-surface stack">
        @if (error()) {
          <h1>Invite problem</h1>
          <p class="error" role="alert">{{ error() }}</p>
          <a class="btn" routerLink="/">Go home</a>
        } @else if (info(); as i) {
          <h1>Join {{ i.teamName }}</h1>
          <p>You've been invited as a <strong>{{ i.role }}</strong>.</p>
          @if (auth.me()) {
            <button class="btn primary" type="button" (click)="accept()" [disabled]="busy()">Join team</button>
          } @else {
            <a class="btn primary" routerLink="/login" [queryParams]="{ invite: token(), next: '/invite/' + token() }">Sign in or create an account</a>
          }
        } @else {
          <p class="muted">Loading invite…</p>
        }
      </div>
    </div>
  `,
})
export class InvitePage {
  protected auth = inject(AuthService);
  private api = inject(Api);
  private router = inject(Router);
  readonly token = input.required<string>();
  protected info = signal<{ teamName: string; role: string } | null>(null);
  protected error = signal<string | null>(null);
  protected busy = signal(false);

  constructor() {
    queueMicrotask(async () => {
      await this.auth.ensureLoaded();
      try {
        this.info.set(await this.api.get(`/api/invites/by-token/${encodeURIComponent(this.token())}`));
      } catch (err) {
        this.error.set(errorMessage(err));
      }
    });
  }

  async accept() {
    this.busy.set(true);
    try {
      const { teamId } = await this.api.post<{ teamId: string }>(`/api/invites/by-token/${encodeURIComponent(this.token())}/accept`);
      await this.router.navigate(['/teams', teamId]);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
