import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { TeamMemberDto, UserDto } from '@retro/shared';
import { Api } from '../core/api.service';
import { Avatar } from '../shared/avatar';
import { Modal } from '../shared/modal';
import { BoardStore } from './board.store';

const ROLE_LABELS: Record<string, string> = { admin: 'Team admin', member: 'Member', viewer: 'Viewer' };

/** A person's details, opened by clicking their face or name on a card or reply. */
@Component({
  selector: 'app-person-details',
  imports: [Avatar, Modal, DatePipe],
  template: `
    <app-modal [heading]="user().name" (closed)="closed.emit()">
      <div class="person-details">
        <app-avatar [user]="user()" [size]="72" />
        <dl class="settings-grid">
          @if (email(); as e) { <dt>Email</dt><dd><a [href]="'mailto:' + e">{{ e }}</a></dd> }
          @if (member(); as m) {
            <dt>Team role</dt><dd>{{ roleLabel(m.role) }}</dd>
            <dt>Joined team</dt><dd>{{ m.joinedAt | date: 'mediumDate' }}</dd>
          } @else if (!loaded()) {
            <dt>Team role</dt><dd class="muted">Loading…</dd>
          } @else {
            <dt>Team role</dt><dd class="muted">Not on this team</dd>
          }
          <dt>On this board</dt>
          <dd>{{ cardCount() }} card{{ cardCount() === 1 ? '' : 's' }}@if (likes()) { · 👍 {{ likes() }} }</dd>
          <dt>Here now</dt><dd>{{ here() ? 'Yes' : 'No' }}</dd>
        </dl>
      </div>
    </app-modal>
  `,
})
export class PersonDetails {
  private api = inject(Api);
  private store = inject(BoardStore);
  readonly user = input.required<UserDto>();
  readonly closed = output<void>();

  protected member = signal<TeamMemberDto | null>(null);
  protected loaded = signal(false);
  protected email = computed(() => this.member()?.user.email ?? this.user().email);
  /** Only cards they put their name to: anonymous cards never count, or they'd give the author away */
  private cards = computed(() => this.store.cards().filter(c => !c.anonymous && c.author?.id === this.user().id));
  protected cardCount = computed(() => this.cards().length);
  protected likes = computed(() => this.cards().reduce((n, c) => n + c.likes, 0));
  protected here = computed(() => this.store.presence().some(u => u.id === this.user().id));

  constructor() {
    effect(() => {
      const id = this.user().id;
      const teamId = this.store.board()?.teamId;
      if (!teamId) return;
      this.loaded.set(false);
      void this.api.get<TeamMemberDto[]>(`/api/teams/${teamId}/members`)
        .then(list => this.member.set(list.find(m => m.user.id === id) ?? null))
        .catch(() => this.member.set(null))
        .finally(() => this.loaded.set(true));
    });
  }

  protected roleLabel(role: string) {
    return ROLE_LABELS[role] ?? role;
  }
}
