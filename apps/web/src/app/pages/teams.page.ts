import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { TeamDto } from '@retro/shared';
import { Api } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { Modal } from '../shared/modal';

import { TeamPhoto } from '../shared/team-photo';
@Component({
  selector: 'app-teams-page',
  imports: [RouterLink, FormsModule, Modal, TeamPhoto],
  template: `
    <div class="page">
      <div class="page-head">
        <h1>Your Teams</h1>
        <div class="spacer"></div>
        <!-- In no-sign-in mode everyone already sees every team, so there's nothing to show -->
        @if (auth.isAdmin() && !auth.open()) {
          <label class="check"><input type="checkbox" [checked]="showAll()" (change)="toggleAll()"> Show Every Team</label>
        }
        <button class="btn primary" type="button" (click)="creating.set(true)">New Team</button>
      </div>

      @if (teams() === null) {
        <p class="muted">Loading…</p>
      } @else if (!teams()!.length) {
        <div class="empty card-surface">
          <h2>No Teams Yet</h2>
          <p>Create a team, then invite people with a link. Each team keeps its own boards, history and action items.</p>
          <button class="btn primary" type="button" (click)="creating.set(true)">Create Your First Team</button>
        </div>
      } @else {
        <ul class="grid-cards">
          @for (t of teams(); track t.id) {
            <li>
              <a class="team-tile card-surface" [routerLink]="['/teams', t.id]">
                <div class="team-tile-head"><app-team-photo [team]="t" [size]="44" /><h2>{{ t.name }}</h2>
                  @if (t.password.set) {
                    <span class="lock-tag" [title]="t.password.unlocked ? 'Has a password; this browser can get in' : 'Needs a password'">
                      {{ t.password.unlocked ? '🔓' : '🔒' }}<span class="sr-only">{{ t.password.unlocked ? 'Unlocked' : 'Needs a password' }}</span></span>
                  }</div>
                @if (t.description) { <p class="muted">{{ t.description }}</p> }
                <p class="meta">{{ t.memberCount }} {{ t.memberCount === 1 ? 'member' : 'members' }} · {{ t.myRole ?? 'not a member' }}</p>
              </a>
            </li>
          }
        </ul>
      }
    </div>

    @if (creating()) {
      <app-modal heading="New Team" (closed)="creating.set(false)">
        <form class="stack" (ngSubmit)="create()">
          <label>Name <input name="name" [(ngModel)]="name" required maxlength="80" autofocus></label>
          <label>Description <textarea name="desc" [(ngModel)]="description" maxlength="500" rows="3"></textarea></label>
          <div class="row end"><button class="btn primary" type="submit" [disabled]="!name.trim()">Create Team</button></div>
        </form>
      </app-modal>
    }
  `,
})
export class TeamsPage {
  protected auth = inject(AuthService);
  private api = inject(Api);
  private router = inject(Router);
  private toast = inject(ToastService);
  protected teams = signal<TeamDto[] | null>(null);
  protected creating = signal(false);
  protected showAll = signal(false);
  protected name = '';
  protected description = '';

  constructor() {
    void this.load();
  }

  async load() {
    this.teams.set(await this.api.get<TeamDto[]>(`/api/teams${this.showAll() ? '?all=1' : ''}`));
  }

  toggleAll() {
    this.showAll.update(v => !v);
    void this.load();
  }

  async create() {
    try {
      const t = await this.api.post<TeamDto>('/api/teams', { name: this.name, description: this.description });
      await this.router.navigate(['/teams', t.id]);
    } catch (err) {
      this.toast.error(err);
    }
  }
}
