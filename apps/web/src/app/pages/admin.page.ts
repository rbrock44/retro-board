import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { UserDto } from '@retro/shared';
import { Api } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { Avatar } from '../shared/avatar';
import { RelativeTimePipe } from '../shared/relative-time.pipe';

@Component({
  selector: 'app-admin-page',
  imports: [FormsModule, Avatar, RelativeTimePipe],
  template: `
    <div class="page stack">
      <h1>Instance admin</h1>
      <p class="muted">Instance admins manage accounts and act as admin on every team. Sign-in providers are set in <code>config/auth.yaml</code>.</p>
      <section class="card-surface stack">
        <div class="row">
          <h2>Users ({{ users().length }})</h2><div class="spacer"></div>
          <input type="search" [ngModel]="filter()" (ngModelChange)="filter.set($event)" placeholder="Filter by name or email" aria-label="Filter users">
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>User</th><th>Email</th><th>Joined</th><th>Role</th><th>Status</th></tr></thead>
            <tbody>
              @for (u of shown(); track u.id) {
                <tr [class.muted]="u.disabled">
                  <td><span class="row"><app-avatar [user]="u" [size]="24" /> {{ u.name }}</span></td>
                  <td>{{ u.email }}</td>
                  <td>{{ u.createdAt | ago }}</td>
                  <td>
                    <select [ngModel]="u.role" (ngModelChange)="update(u, { role: $event })" [attr.aria-label]="'Role for ' + u.name">
                      <option value="user">user</option><option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    @if (u.id !== auth.me()?.id) {
                      <button class="btn ghost" [class.danger]="!u.disabled" type="button" (click)="update(u, { disabled: !u.disabled })">{{ u.disabled ? 'Enable' : 'Disable' }}</button>
                    } @else { <span class="muted">you</span> }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `,
})
export class AdminPage {
  protected auth = inject(AuthService);
  private api = inject(Api);
  private toast = inject(ToastService);
  protected users = signal<UserDto[]>([]);
  protected filter = signal('');
  protected shown = computed(() => {
    const f = this.filter().toLowerCase();
    return this.users().filter(u => !f || u.name.toLowerCase().includes(f) || (u.email ?? '').includes(f));
  });

  constructor() {
    void this.load();
  }

  async load() {
    this.users.set(await this.api.get<UserDto[]>('/api/admin/users'));
  }

  async update(u: UserDto, patch: { role?: string; disabled?: boolean }) {
    try {
      await this.api.patch(`/api/admin/users/${u.id}`, patch);
    } catch (err) {
      this.toast.error(err);
    }
    await this.load();
  }
}
