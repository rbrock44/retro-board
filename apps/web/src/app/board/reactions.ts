import { Component, input, output, signal } from '@angular/core';
import { REACTION_EMOJI, type ReactionSummary } from '@retro/shared';
import { ClickOutside } from '../shared/click-outside';
import { EmojiPicker } from '../shared/emoji-picker';

@Component({
  selector: 'app-reactions',
  imports: [ClickOutside, EmojiPicker],
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
          <button #add type="button" class="reaction add" (click)="open.set(!open())" aria-label="Add reaction" [attr.aria-expanded]="open()" title="Add reaction">
            <!-- an SVG, not "☺+": font glyphs sit below the middle of the pill -->
            <svg viewBox="0 0 22 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" /><path d="M4.9 8.4c.9 1.2 3.3 1.2 4.2 0" />
              <circle class="eye" cx="5.2" cy="5.6" r=".55" /><circle class="eye" cx="8.8" cy="5.6" r=".55" /><path d="M15.5 7h5M18 4.5v5" /></svg>
          </button>
          @if (open()) {
            <span class="react-pop" role="menu">
              @for (e of emoji; track e) {
                <button type="button" role="menuitem" (click)="toggle.emit(e); open.set(false)" [attr.aria-label]="'React ' + e">{{ e }}</button>
              }
              <!-- every other emoji, with search -->
              <button type="button" role="menuitem" class="react-more" (click)="open.set(false); more.set(true)"
                      aria-label="More emoji" title="More emoji (search them all)">🔍</button>
            </span>
          }
          @if (more()) {
            <app-emoji-picker [anchor]="add" (picked)="toggle.emit($event)" (closed)="more.set(false)" />
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
  protected more = signal(false);
  protected emoji = REACTION_EMOJI;
}
