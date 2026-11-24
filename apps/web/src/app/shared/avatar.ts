import { Component, computed, input } from '@angular/core';
import type { UserDto } from '@retro/shared';

const HUES = [210, 260, 330, 20, 140, 180, 45, 290];

@Component({
  selector: 'app-avatar',
  template: `
    @if (user()?.avatarUrl) {
      <img class="avatar" [src]="user()!.avatarUrl" [alt]="user()!.name" [title]="user()!.name"
           [style.width.px]="size()" [style.height.px]="size()" referrerpolicy="no-referrer">
    } @else {
      <span class="avatar initials" [title]="user()?.name ?? 'Anonymous'" [style.width.px]="size()" [style.height.px]="size()"
            [style.font-size.px]="size() * 0.42" [style.background]="color()">{{ initials() }}</span>
    }
  `,
})
export class Avatar {
  readonly user = input<UserDto | null>(null);
  readonly size = input(28);

  readonly initials = computed(() => {
    const name = this.user()?.name ?? '?';
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?';
  });

  readonly color = computed(() => {
    const id = this.user()?.id ?? '';
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return this.user() ? `hsl(${HUES[h % HUES.length]} 55% 45%)` : 'var(--muted)';
  });
}
