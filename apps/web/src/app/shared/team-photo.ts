import { Component, computed, input } from '@angular/core';

const HUES = [210, 260, 330, 20, 140, 180, 45, 290];

/** A team's display photo, or its initials on a color of its own. Rounded square, so teams don't read as people. */
@Component({
  selector: 'app-team-photo',
  template: `
    @if (team().photoUrl) {
      <img class="team-photo" [src]="team().photoUrl" [alt]="team().name" [style.width.px]="size()" [style.height.px]="size()">
    } @else {
      <span class="team-photo initials" aria-hidden="true" [style.width.px]="size()" [style.height.px]="size()"
            [style.font-size.px]="size() * 0.4" [style.background]="color()">{{ initials() }}</span>
    }
  `,
})
export class TeamPhoto {
  readonly team = input.required<{ id: string; name: string; photoUrl: string | null }>();
  readonly size = input(40);

  readonly initials = computed(() =>
    this.team().name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?');

  readonly color = computed(() => {
    let h = 0;
    for (const ch of this.team().id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${HUES[h % HUES.length]} 45% 42%)`;
  });
}
