import { Component, input, model } from '@angular/core';
import { COLOR_PRESETS, isHexColor, readableTextOn } from '@retro/shared';

/** Preset swatches, a native color wheel, and a hex field, all bound to one #rrggbb value. */
@Component({
  selector: 'app-color-picker',
  template: `
    <div class="color-picker" role="group" [attr.aria-label]="label()">
      <div class="swatches">
        @for (c of presets(); track c) {
          <button type="button" class="swatch" [style.background]="c" [class.selected]="c === value()"
                  [attr.aria-label]="c" [attr.aria-pressed]="c === value()" (click)="value.set(c)">
            @if (c === value()) { <span [style.color]="ink(c)">✓</span> }
          </button>
        }
      </div>
      <div class="custom">
        <input type="color" [value]="value()" (input)="fromWheel($event)" [attr.aria-label]="label() + ' custom color'">
        <input class="hex" type="text" maxlength="7" spellcheck="false" [value]="value()"
               (change)="fromText($event)" [attr.aria-label]="label() + ' hex value'">
      </div>
    </div>
  `,
})
export class ColorPicker {
  readonly value = model.required<string>();
  readonly label = input('Color');
  readonly presets = input<string[]>(COLOR_PRESETS);

  ink = readableTextOn;

  fromWheel(e: Event) {
    this.value.set((e.target as HTMLInputElement).value.toLowerCase());
  }

  fromText(e: Event) {
    const el = e.target as HTMLInputElement;
    let v = el.value.trim();
    if (!v.startsWith('#')) v = `#${v}`;
    if (/^#[0-9a-f]{3}$/i.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
    if (isHexColor(v)) this.value.set(v.toLowerCase());
    else el.value = this.value();
  }
}
