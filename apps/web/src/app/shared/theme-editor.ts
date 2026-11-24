import { Component, computed, input, model } from '@angular/core';
import {
  THEME_PRESETS, THEME_TOKEN_LABELS, contrastRatio, type ThemePreference, type ThemeTokens,
} from '@retro/shared';
import { themeStyle } from '../core/theme.service';
import { ColorPicker } from './color-picker';

/**
 * Pick a preset, then fine-tune any color. Shows a live preview and warns when text would be hard
 * to read. Used for the personal theme and for a board's own theme.
 */
@Component({
  selector: 'app-theme-editor',
  imports: [ColorPicker],
  template: `
    <div class="theme-editor">
      <div class="preset-grid" role="radiogroup" aria-label="Theme presets">
        @for (p of presets; track p.id) {
          <button type="button" role="radio" class="preset" [attr.aria-checked]="value().preset === p.id"
                  [class.selected]="value().preset === p.id" (click)="pick(p.id)">
            <span class="preset-preview" [style.background]="p.tokens.bg" [style.border-color]="p.tokens.border">
              <span [style.background]="p.tokens.surface"></span>
              <span [style.background]="p.tokens.accent"></span>
              <span [style.background]="p.tokens.text"></span>
            </span>
            {{ p.name }}
          </button>
        }
        @if (value().preset === 'custom') {
          <span class="preset selected custom-badge">Custom</span>
        }
      </div>

      <div class="preview" [style]="previewStyle()" aria-hidden="true">
        <div class="preview-card">
          <strong>Preview</strong>
          <p>Cards, text and <span class="preview-muted">muted details</span> look like this.</p>
          <span class="preview-btn">Button</span> <span class="preview-danger">Delete</span>
        </div>
      </div>

      @if (warnings().length) {
        <ul class="warnings" role="status">
          @for (w of warnings(); track w) { <li>⚠ {{ w }}</li> }
        </ul>
      }

      <details [open]="compact() ? null : ''">
        <summary>Fine-tune colors</summary>
        <div class="token-grid">
          @for (k of keys; track k) {
            <div class="token">
              <span class="token-label">{{ labels[k] }}</span>
              <app-color-picker [value]="value().tokens[k]" (valueChange)="setToken(k, $event)" [label]="labels[k]" [presets]="swatchesFor(k)" />
            </div>
          }
        </div>
      </details>
    </div>
  `,
})
export class ThemeEditor {
  readonly value = model.required<ThemePreference>();
  readonly compact = input(false);

  protected presets = THEME_PRESETS;
  protected labels = THEME_TOKEN_LABELS;
  protected keys = Object.keys(THEME_TOKEN_LABELS) as (keyof ThemeTokens)[];

  protected previewStyle = computed(() => themeStyle(this.value().tokens));
  protected warnings = computed(() => {
    const t = this.value().tokens;
    const out: string[] = [];
    if (contrastRatio(t.text, t.bg) < 4.5) out.push('Text is hard to read on the background');
    if (contrastRatio(t.text, t.surface) < 4.5) out.push('Text is hard to read on cards');
    if (contrastRatio(t.accentText, t.accent) < 3) out.push('Button text is hard to read on the accent color');
    if (contrastRatio(t.muted, t.surface) < 3) out.push('Muted text nearly disappears on cards');
    return out;
  });

  /** Offers each token's value from every preset as quick swatches. */
  swatchesFor(k: keyof ThemeTokens): string[] {
    return [...new Set(THEME_PRESETS.map(p => p.tokens[k]))];
  }

  pick(id: string) {
    const p = THEME_PRESETS.find(x => x.id === id)!;
    this.value.set({ preset: p.id, tokens: { ...p.tokens } });
  }

  setToken(k: keyof ThemeTokens, v: string) {
    this.value.set({ preset: 'custom', tokens: { ...this.value().tokens, [k]: v } });
  }
}
