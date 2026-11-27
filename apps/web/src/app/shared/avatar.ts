import { Component, computed, inject, input, signal } from '@angular/core';
import type { UserDto } from '@retro/shared';
import { PersonShades } from '../core/person-shades.service';

const HUES = [210, 260, 330, 20, 140, 180, 45, 290];

@Component({
  selector: 'app-avatar',
  host: {
    '(mouseenter)': 'showTip($event)',
    '(mouseleave)': 'tip.set(null)',
  },
  template: `
    @if (user()?.avatarUrl) {
      <img class="avatar" [class.person-ring]="hue() !== null" [style.--person-hue]="hue()" [src]="user()!.avatarUrl" [alt]="user()!.name"
           [style.width.px]="size()" [style.height.px]="size()" referrerpolicy="no-referrer">
    } @else {
      <span class="avatar initials" role="img" [attr.aria-label]="name()" [class.person-ring]="hue() !== null" [style.--person-hue]="hue()" [style.width.px]="size()" [style.height.px]="size()"
            [style.font-size.px]="size() * 0.42" [style.background]="color()">{{ initials() }}</span>
    }
    <!-- the name, shown at once on hover; fixed to the viewport so card edges and scroll boxes don't clip it -->
    @if (tip(); as t) {
      <span class="person-tip" aria-hidden="true" [style.left.px]="t.x" [style.top.px]="t.y">{{ name() }}</span>
    }
  `,
})
export class Avatar {
  readonly user = input<UserDto | null>(null);
  readonly size = input(28);
  private shades = inject(PersonShades);
  /** The person's shade hue (see PersonShades), for a ring that matches their cards */
  readonly hue = computed(() => this.shades.hueFor(this.user()));
  readonly name = computed(() => this.user()?.name ?? 'Anonymous');
  protected tip = signal<{ x: number; y: number } | null>(null);

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

  /** Centered under the face */
  showTip(e: MouseEvent) {
    const host = e.currentTarget as HTMLElement;
    const r = (host.querySelector('.avatar') ?? host).getBoundingClientRect();
    this.tip.set({ x: r.left + r.width / 2, y: r.bottom + 6 });
  }
}
