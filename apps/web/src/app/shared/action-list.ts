import { Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { ActionItemDto, UserDto } from '@retro/shared';
import { Api } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { Avatar } from './avatar';

/** Action items with inline editing, used on the team page and in the board sidebar. */
@Component({
  selector: 'app-action-list',
  imports: [FormsModule, RouterLink, Avatar],
  template: `
    @if (canEdit()) {
      <form class="row action-add" (ngSubmit)="add()">
        <input name="title" [(ngModel)]="title" placeholder="New action item…" class="grow" maxlength="300" aria-label="New action item">
        <button class="btn primary" type="submit" [disabled]="!title.trim()">Add</button>
      </form>
    }
    <ul class="action-list">
      @for (a of actions(); track a.id) {
        <li [class.done]="a.status === 'done'">
          <input type="checkbox" [checked]="a.status === 'done'" [disabled]="!canEdit()" (change)="toggle(a)"
                 [attr.aria-label]="'Mark ' + a.title + (a.status === 'done' ? ' open' : ' done')">
          <div class="grow stack-tight">
            @if (canEdit()) {
              <input class="inline-edit" [value]="a.title" (change)="rename(a, $event)" aria-label="Action title">
            } @else { <span>{{ a.title }}</span> }
            <div class="row wrap meta">
              @if (canEdit()) {
                <select [ngModel]="a.owner?.id ?? ''" (ngModelChange)="setOwner(a, $event)" aria-label="Owner">
                  <option value="">No owner</option>
                  @for (m of members(); track m.id) { <option [value]="m.id">{{ m.name }}</option> }
                </select>
                <input type="date" [value]="a.dueDate ?? ''" (change)="setDue(a, $event)" aria-label="Due date">
              } @else {
                @if (a.owner) { <span class="row"><app-avatar [user]="a.owner" [size]="18" /> {{ a.owner.name }}</span> }
                @if (a.dueDate) { <span>due {{ a.dueDate }}</span> }
              }
              @if (showBoard() && a.boardId) { <a [routerLink]="['/boards', a.boardId]">{{ a.boardTitle }}</a> }
              @if (overdue(a)) { <span class="tag danger">overdue</span> }
            </div>
          </div>
          @if (canEdit()) { <button class="icon-btn" type="button" (click)="remove(a)" [attr.aria-label]="'Delete ' + a.title">🗑</button> }
        </li>
      } @empty {
        <li class="muted">No action items.</li>
      }
    </ul>
  `,
})
export class ActionList {
  private api = inject(Api);
  private toast = inject(ToastService);

  readonly actions = input.required<ActionItemDto[]>();
  readonly members = input<UserDto[]>([]);
  readonly teamId = input.required<string>();
  readonly boardId = input<string | null>(null);
  readonly canEdit = input(false);
  readonly showBoard = input(false);
  readonly changed = output<void>();

  protected title = '';

  overdue(a: ActionItemDto) {
    return a.status === 'open' && !!a.dueDate && a.dueDate < new Date().toISOString().slice(0, 10);
  }

  private async run(p: Promise<unknown>) {
    try {
      await p;
      this.changed.emit();
    } catch (err) {
      this.toast.error(err);
    }
  }

  add() {
    const title = this.title.trim();
    this.title = '';
    return this.run(this.api.post(`/api/teams/${this.teamId()}/actions`, { title, boardId: this.boardId() }));
  }
  toggle(a: ActionItemDto) { return this.run(this.api.patch(`/api/actions/${a.id}`, { status: a.status === 'done' ? 'open' : 'done' })); }
  rename(a: ActionItemDto, e: Event) {
    const title = (e.target as HTMLInputElement).value.trim();
    if (title && title !== a.title) return this.run(this.api.patch(`/api/actions/${a.id}`, { title }));
    return undefined;
  }
  setOwner(a: ActionItemDto, ownerId: string) { return this.run(this.api.patch(`/api/actions/${a.id}`, { ownerId: ownerId || null })); }
  setDue(a: ActionItemDto, e: Event) { return this.run(this.api.patch(`/api/actions/${a.id}`, { dueDate: (e.target as HTMLInputElement).value || null })); }
  remove(a: ActionItemDto) {
    if (!confirm(`Delete “${a.title}”?`)) return undefined;
    return this.run(this.api.delete(`/api/actions/${a.id}`));
  }
}
