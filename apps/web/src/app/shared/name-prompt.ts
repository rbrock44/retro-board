import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { Modal } from './modal';

/** Asks a guest (no-sign-in mode) for a name the first time they write a card or reply. */
@Component({
  selector: 'app-name-prompt',
  imports: [FormsModule, Modal],
  template: `
    <app-modal heading="What's your name?" (closed)="finish(false)">
      <form class="stack" (ngSubmit)="save()">
        <p class="muted">Shown on your cards and replies. You can change it later in Profile &amp; theme.</p>
        <label>Name <input name="name" [(ngModel)]="name" required maxlength="100" autofocus autocomplete="name"></label>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        <div class="row end">
          <button type="submit" class="btn primary" [disabled]="!name.trim() || saving()">Continue</button>
        </div>
      </form>
    </app-modal>
  `,
})
export class NamePrompt {
  private auth = inject(AuthService);
  protected name = '';
  protected saving = signal(false);
  protected error = signal('');
  private done = false;

  async save() {
    if (!this.name.trim()) return;
    this.saving.set(true);
    try {
      await this.auth.updateMe({ name: this.name.trim() });
      this.finish(true);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not save your name');
    } finally {
      this.saving.set(false);
    }
  }

  finish(ok: boolean) {
    if (this.done) return;
    this.done = true;
    this.auth.namePrompt()?.(ok);
  }
}
