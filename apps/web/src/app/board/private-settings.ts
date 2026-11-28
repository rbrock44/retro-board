import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { BoardDto } from '@retro/shared';
import { Api } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';

/**
 * Board Settings > Private board (hidden): kept out of the team's lists and opened by its link (plus by its
 * creator and the team's admins). Here its facilitators copy the link, replace it to cut off everyone who had the
 * old one, and give the board its own password.
 */
@Component({
  selector: 'app-private-settings',
  imports: [FormsModule],
  template: `
    <section class="private-settings stack">
      <label class="check stacked"><input type="checkbox" [checked]="board().private" [disabled]="busy()" (change)="setPrivate($any($event.target).checked)">
        <span><strong>Private board (hidden)</strong>
          <span class="muted small">Only people with its link can open it, plus you and the team's admins. It stays out of the
            team's board list, search and action items.</span></span></label>
      @if (board().private && link(); as code) {
        <div class="private-link">
          <code class="grow">{{ url(code) }}</code>
          <button type="button" class="btn" (click)="copy(code)">Copy Link</button>
          <button type="button" class="btn ghost" (click)="newLink()" [disabled]="busy()"
                  title="Everyone who opened the old link loses access">New Link</button>
        </div>
        <form class="row wrap private-password" (ngSubmit)="setPassword(next)">
          <label class="grow">{{ board().hasPassword ? 'New password' : 'Password (optional)' }}
            <input name="pw" type="password" [(ngModel)]="next" minlength="4" maxlength="200" autocomplete="new-password"
                   [placeholder]="board().hasPassword ? 'Leave as it is' : 'No password'"></label>
          <button type="submit" class="btn" [disabled]="busy() || next.length < 4">{{ board().hasPassword ? 'Change' : 'Set' }} Password</button>
          @if (board().hasPassword) {
            <button type="button" class="btn ghost danger" [disabled]="busy()" (click)="setPassword(null)">Remove Password</button>
          }
        </form>
        <p class="muted small">{{ board().hasPassword ? '🔒 Everyone who opens the link types the password once; you never do.'
          : 'With a password, people who open the link also type it once.' }} Changing it asks everyone again.</p>
      }
    </section>
  `,
})
export class PrivateSettings {
  private api = inject(Api);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  readonly board = input.required<BoardDto>();
  /** The link's code (only facilitators get it) */
  readonly link = input<string | null | undefined>(null);
  /** Something changed: the board page loads the board again */
  readonly changed = output<void>();
  protected busy = signal(false);
  protected next = '';

  /** Built from PUBLIC_URL when you're on localhost but the site is shared at another address */
  protected url(code: string) {
    const shared = this.auth.config()?.publicUrl;
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    const base = local && shared && !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]?/.test(shared) ? shared : location.origin;
    return `${base}/b/${code}`;
  }

  protected async copy(code: string) {
    try {
      await navigator.clipboard.writeText(this.url(code));
      this.toast.show('Link copied. Anyone with it can open this board');
    } catch {
      prompt('Copy this link', this.url(code));
    }
  }

  private async run(work: () => Promise<unknown>, done: string) {
    this.busy.set(true);
    try {
      await work();
      this.toast.show(done);
      this.changed.emit();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected setPrivate(on: boolean) {
    if (!on && !confirm('Make this board visible to the whole team again? Its link and password stop working.')) return;
    void this.run(() => this.api.put(`/api/boards/${this.board().id}/private`, { private: on }),
      on ? 'Private: only its link opens it' : 'Visible to the team again');
  }

  protected newLink() {
    if (!confirm('Make a new link? Everyone who opened the old one loses access until you send them the new one.')) return;
    void this.run(() => this.api.post(`/api/boards/${this.board().id}/private/new-link`, {}), 'New link made. The old one no longer works');
  }

  protected setPassword(password: string | null) {
    if (password === null && !confirm('Remove the password? Anyone with the link can then open the board.')) return;
    void this.run(async () => {
      await this.api.put(`/api/boards/${this.board().id}/password`, { password });
      this.next = '';
    }, password ? 'Password set' : 'Password removed');
  }
}
