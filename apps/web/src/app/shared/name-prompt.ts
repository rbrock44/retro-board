import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService, type KnownGuest, type WhoMode } from '../core/auth.service';
import { errorMessage } from '../core/api.service';
import { Avatar } from './avatar';
import { Modal } from './modal';

/**
 * No-sign-in mode: "Who are you?". Offers the people this device has been and the team's other guests
 * ("Are you one of these?"), or a new name. Shown before a guest's first card or reply, when a nameless
 * guest opens a team that has people, and from "Switch person" in the menu.
 */
@Component({
  selector: 'app-name-prompt',
  imports: [FormsModule, Modal, Avatar],
  template: `
    <app-modal [heading]="heading()" (closed)="finish(false)">
      <div class="stack">
        @if (candidates().length) {
          <p class="muted">{{ mode() === 'switch' ? 'Pick who you are:' : 'People who have been here before. Are you one of them?' }}</p>
          <ul class="who-list">
            @for (c of candidates(); track c.id) {
              <li>
                <button type="button" class="who-pick" (click)="pick(c)" [disabled]="busy()">
                  <app-avatar [user]="{ id: c.id, name: c.name, email: null, avatarUrl: null, role: 'user' }" [size]="28" />
                  <span>{{ c.name }}</span>
                  @if (c.onDevice) { <span class="chip">this device</span> }
                </button>
                @if (c.onDevice) {
                  <button type="button" class="icon-btn small" (click)="forget(c)" [attr.aria-label]="'Forget ' + c.name" title="Forget on this device">✕</button>
                }
              </li>
            }
          </ul>
          <p class="muted small">{{ mode() === 'switch' ? 'Or someone else:' : "No? You're new here:" }}</p>
        } @else if (mode() !== 'switch') {
          <p class="muted">Your name goes on your cards and replies. You can change it later in Profile &amp; theme.</p>
        }
        <form class="row" (ngSubmit)="save()">
          <input name="name" [(ngModel)]="name" required maxlength="100" autocomplete="name" class="grow"
                 [placeholder]="'Your name'" aria-label="Your name" [autofocus]="!candidates().length">
          <button type="submit" class="btn primary" [disabled]="!name.trim() || busy()">Continue</button>
        </form>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        @if (mode() === 'welcome') {
          <div class="row end"><button type="button" class="btn ghost small" (click)="finish(false)">Just looking</button></div>
        }
      </div>
    </app-modal>
  `,
})
export class NamePrompt {
  private auth = inject(AuthService);
  readonly mode = input<WhoMode>('name');
  protected name = '';
  protected busy = signal(false);
  protected error = signal('');
  protected candidates = signal<KnownGuest[]>([]);
  protected heading = computed(() => (this.mode() === 'switch' ? 'Switch person' : this.mode() === 'welcome' ? 'Welcome! Who are you?' : "What's your name?"));
  private done = false;

  constructor() {
    void this.auth.guestCandidates(this.auth.teamContext()).then(c => this.candidates.set(c)).catch(() => {
      this.candidates.set(this.auth.knownGuests().filter(g => g.id !== this.auth.me()?.id));
    });
  }

  async pick(c: KnownGuest) {
    await this.run(() => this.auth.claimGuest(c.id), true);
  }

  forget(c: KnownGuest) {
    this.auth.forgetGuest(c.id);
    this.candidates.update(list => list.filter(x => x.id !== c.id));
  }

  async save() {
    const name = this.name.trim();
    if (!name) return;
    const someoneElse = !this.auth.me()?.needsName;
    await this.run(async () => {
      // Already someone? "Someone else" starts a fresh guest rather than renaming them.
      if (someoneElse) await this.auth.newGuest();
      await this.auth.updateMe({ name });
    }, someoneElse);
  }

  /** `switched`: became a different person, so reload to reconnect live updates and votes as them. */
  private async run(fn: () => Promise<void>, switched = false) {
    this.busy.set(true);
    this.error.set('');
    try {
      await fn();
      if (switched && this.mode() !== 'name') return location.reload();
      this.finish(true);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  finish(ok: boolean) {
    if (this.done) return;
    this.done = true;
    this.auth.whoPrompt()?.done(ok);
  }
}
