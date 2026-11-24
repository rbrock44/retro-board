import { Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api.service';

/**
 * /teams/:teamId — opening a team goes straight to its current board (the server makes one if there's none and
 * you may create boards). People who can only view, on a team with no open board, land on the history instead.
 */
@Component({
  selector: 'app-current-board-page',
  imports: [RouterLink],
  template: `
    <div class="page">
      @if (error(); as err) {
        <p class="error" role="alert">{{ err }}</p>
        <a routerLink="/">Back to teams</a>
      } @else {
        <p class="muted">Opening the current board…</p>
      }
    </div>
  `,
})
export class CurrentBoardPage {
  private api = inject(Api);
  private router = inject(Router);
  readonly teamId = input.required<string>();
  protected error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.teamId();
      void this.api.post<{ boardId: string | null }>(`/api/teams/${id}/current`)
        .then(r => this.router.navigate(r.boardId ? ['/boards', r.boardId] : ['/teams', id, 'history'], { replaceUrl: true }))
        .catch(err => this.error.set(errorMessage(err)));
    });
  }
}
