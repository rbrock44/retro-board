import { Component, input, output, signal } from '@angular/core';
import { REACTION_EMOJI, type ReactionSummary } from '@retro/shared';
import { ClickOutside } from '../shared/click-outside';

@Component({
  selector: 'app-reactions',
  imports: [ClickOutside],
  template: `
    <div class="reactions">
      @for (r of items(); track r.emoji) {
        <button type="button" class="reaction" [class.mine]="r.mine" [disabled]="!enabled()" (click)="toggle.emit(r.emoji)"
                [title]="r.users.join(', ')" [attr.aria-pressed]="r.mine" [attr.aria-label]="r.emoji + ' ' + r.count">
          {{ r.emoji }} <span>{{ r.count }}</span>
        </button>
      }
      @if (enabled()) {
        <span class="react-wrap" (clickOutside)="open.set(false)">
          <button type="button" class="reaction add" (click)="open.set(!open())" aria-label="Add reaction" [attr.aria-expanded]="open()">☺+</button>
          @if (open()) {
            <span class="react-pop" role="menu">
              @for (e of emoji; track e) {
                <button type="button" role="menuitem" (click)="toggle.emit(e); open.set(false)" [attr.aria-label]="'React ' + e">{{ e }}</button>
              }
            </span>
          }
        </span>
      }
    </div>
  `,
})
export class Reactions {
  readonly items = input.required<ReactionSummary[]>();
  readonly enabled = input(true);
  readonly toggle = output<string>();
  protected open = signal(false);
  protected emoji = REACTION_EMOJI;
}
