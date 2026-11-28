import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { MeDto } from '@retro/shared';
import { Api, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';

/**
 * No-sign-in mode: becoming the site admin with the setup code that `./launch.sh admin-code` prints on the server.
 * The code works once; a new one can be made any time.
 */
@Component({
  selector: 'app-claim-admin-page',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page narrow">
      <form class="card-surface stack claim-admin" (ngSubmit)="claim()">
        <h1>Claim Admin</h1>
        @if (auth.isAdmin()) {
          <p>You're a site admin already. Make others admins too from the <a routerLink="/admin">Admin</a> page.</p>
        } @else {
          <p>The site admin runs everything here: every team, the look, features and limits, and who else is an admin.
            If you set this site up, get a setup code from the server:</p>
          <pre><code>./launch.sh admin-code</code></pre>
          <p class="muted small">On Windows: <code>launch.cmd admin-code</code>. Each code works once, and making a new one retires the last.</p>
          <label>Setup code
            <input name="code" [(ngModel)]="code" autocomplete="off" autocapitalize="characters" spellcheck="false"
                   placeholder="XXXX-XXXX-XXXX" autofocus [attr.aria-invalid]="!!error()" aria-describedby="claim-error"></label>
          <p id="claim-error" class="error" role="alert">{{ error() }}</p>
          <div class="row"><button type="submit" class="btn primary" [disabled]="!code.trim() || busy()">{{ busy() ? 'Checking…' : 'Claim Admin' }}</button></div>
        }
      </form>
    </div>
  `,
})
export class ClaimAdminPage {
  protected auth = inject(AuthService);
  private api = inject(Api);
  private router = inject(Router);
  private toast = inject(ToastService);
  protected code = '';
  protected busy = signal(false);
  protected error = signal('');

  async claim() {
    this.busy.set(true);
    this.error.set('');
    try {
      const me = await this.api.post<MeDto>('/api/auth/admin-code', { code: this.code });
      this.auth.setMe(me);
      this.auth.config.update(c => (c ? { ...c, needsAdmin: false } : c));
      this.toast.show("You're the site admin now");
      await this.router.navigate(['/admin']);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
