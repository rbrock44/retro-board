import { Component, inject, input, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api.service';

/** `/b/<code>`: a private board's link. Opening it lets this person in (until the link is replaced), then shows the board. */
@Component({
  selector: 'app-private-link-page',
  imports: [RouterLink],
  template: `
    <div class="page narrow">
      @if (error(); as e) {
        <h1>That link doesn't work</h1>
        <p class="muted">{{ e }}. It may have been replaced with a new one: ask whoever shared it.</p>
        <a routerLink="/">Go to your teams</a>
      } @else {
        <p class="muted" role="status">Opening the board…</p>
      }
    </div>
  `,
})
export class PrivateLinkPage implements OnInit {
  private api = inject(Api);
  private router = inject(Router);
  readonly token = input.required<string>();
  protected error = signal('');

  async ngOnInit() {
    try {
      const { boardId } = await this.api.post<{ boardId: string }>(`/api/private/${encodeURIComponent(this.token())}`, {});
      await this.router.navigate(['/boards', boardId], { replaceUrl: true });
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}
