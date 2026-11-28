import { Component, computed, inject, input, output, signal } from '@angular/core';
import type { UserDto } from '@retro/shared';
import { Avatar } from '../shared/avatar';
import { Modal } from '../shared/modal';
import { BoardStore } from './board.store';
import { accept, pass, pickNext, type Rotation } from './presenter-rotation';

const storageKey = (teamId: string) => `retro.presenters.${teamId}`;

/**
 * Picks a random teammate to go over a column (or, with no column, to present next), asking them first. Who has gone this round is remembered per team
 * (in this browser), so everyone gets a turn, in random order, before anyone goes twice.
 */
@Component({
  selector: 'app-presenter-picker',
  imports: [Avatar, Modal],
  template: `
    <app-modal [heading]="columnTitle() ? 'Who goes over ' + columnTitle() + '?' : 'Who presents next?'" (closed)="closed.emit()">
      @if (current(); as u) {
        <div class="presenter-pick">
          <app-avatar [user]="u" [size]="96" />
          <p class="presenter-ask"><strong>{{ u.name }}</strong>, you're up! {{ columnTitle() ? 'Will you go over this column?' : 'Will you present next?' }}</p>
          @if (skipped().length) { <p class="muted small">Not right now: {{ skipped().join(', ') }}</p> }
          <div class="row">
            <button type="button" class="btn ghost" (click)="notNow(u)" title="They can't right now (driving, away…). Ask someone else; they stay on the list for later">Not Right Now</button>
            <button type="button" class="btn primary" (click)="yes(u)" autofocus>Yes, I'll Go</button>
          </div>
          <p class="muted small">{{ goneCount() }} of {{ members().length }} have gone this round</p>
        </div>
      } @else {
        <div class="presenter-pick">
          <p>{{ members().length ? 'Everyone left to ask said not right now.' : 'Nobody is on this team to pick.' }}</p>
          @if (members().length) {
            <div class="row"><button type="button" class="btn primary" (click)="askAgain()">Ask Them Again</button></div>
          }
        </div>
      }
    </app-modal>
  `,
})
export class PresenterPicker {
  private store = inject(BoardStore);
  /** The column to go over; null picks who presents next on the board */
  readonly columnTitle = input<string | null>(null);
  readonly closed = output<void>();
  /** Who said yes, for the column header */
  readonly picked = output<UserDto>();

  protected members = computed(() => this.store.members());
  private memberIds = computed(() => this.members().map(m => m.id));
  private teamId = computed(() => this.store.board()?.teamId ?? '');
  private rotation = signal<Rotation>({ done: [], passed: [] });
  protected current = signal<UserDto | null>(null);
  protected skipped = computed(() => this.rotation().passed.map(id => this.members().find(m => m.id === id)?.name ?? 'Someone'));
  protected goneCount = computed(() => this.rotation().done.filter(id => this.memberIds().includes(id)).length);

  constructor() {
    // Each time the picker opens, everyone still owed a turn can be asked again
    this.rotation.set({ done: this.load(), passed: [] });
    this.next();
  }

  protected yes(u: UserDto) {
    this.rotation.set(accept(this.memberIds(), this.rotation(), u.id));
    this.save();
    this.picked.emit(u);
    this.closed.emit();
  }

  protected notNow(u: UserDto) {
    this.rotation.set(pass(this.rotation(), u.id));
    this.next();
  }

  protected askAgain() {
    this.rotation.update(r => ({ ...r, passed: [] }));
    this.next();
  }

  private next() {
    const id = pickNext(this.memberIds(), this.rotation());
    this.current.set(this.members().find(m => m.id === id) ?? null);
  }

  private load(): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(storageKey(this.teamId())) ?? '[]');
      return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private save() {
    try { localStorage.setItem(storageKey(this.teamId()), JSON.stringify(this.rotation().done)); } catch { /* storage blocked */ }
  }
}
