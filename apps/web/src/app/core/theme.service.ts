import { Injectable, computed, signal } from '@angular/core';
import {
  THEME_PRESETS, isDarkTheme, presetById, readableTextOn, sanitizeTokens, type ThemePreference, type ThemeTokens,
} from '@retro/shared';

export const THEME_STORAGE_KEY = 'retro-board-theme';

const CSS_VARS: Record<keyof ThemeTokens, string> = {
  bg: '--bg',
  surface: '--surface',
  surface2: '--surface-2',
  text: '--text',
  muted: '--muted',
  border: '--border',
  accent: '--accent',
  accentText: '--accent-text',
  danger: '--danger',
};

/** CSS custom properties for a token set; also used to scope a board's own theme to the board. */
export function themeStyle(tokens: ThemeTokens): Record<string, string> {
  const style: Record<string, string> = {};
  for (const [k, v] of Object.entries(CSS_VARS)) style[v] = tokens[k as keyof ThemeTokens];
  style['--danger-text'] = readableTextOn(tokens.danger);
  style['color-scheme'] = isDarkTheme(tokens) ? 'dark' : 'light';
  return style;
}

function systemPreset(): ThemePreference {
  const dark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  const p = presetById(dark ? 'dark' : 'light')!;
  return { preset: p.id, tokens: p.tokens };
}

/**
 * The person's colors. Applied to <html> as CSS variables, remembered in localStorage so the next
 * load paints right away (see the inline script in index.html), and saved to their account.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly presets = THEME_PRESETS;
  readonly current = signal<ThemePreference>(this.stored() ?? systemPreset());
  readonly isDark = computed(() => isDarkTheme(this.current().tokens));

  constructor() {
    this.apply(this.current());
  }

  /** Takes the theme saved on the account, without echoing it back to the server. */
  adopt(pref: ThemePreference) {
    this.set(pref);
  }

  set(pref: ThemePreference) {
    const clean = { preset: pref.preset, tokens: sanitizeTokens(pref.tokens) };
    this.current.set(clean);
    this.apply(clean);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // private mode: theme still applies for this visit
    }
  }

  usePreset(id: string) {
    const p = presetById(id);
    if (p) this.set({ preset: p.id, tokens: { ...p.tokens } });
  }

  setToken(key: keyof ThemeTokens, value: string) {
    this.set({ preset: 'custom', tokens: { ...this.current().tokens, [key]: value } });
  }

  resetToSystem() {
    try {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      // ignore
    }
    const p = systemPreset();
    this.current.set(p);
    this.apply(p);
  }

  private apply(pref: ThemePreference) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(themeStyle(pref.tokens))) root.style.setProperty(k, v);
  }

  private stored(): ThemePreference | null {
    try {
      const raw = localStorage.getItem(THEME_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ThemePreference;
      return { preset: String(parsed.preset ?? 'custom'), tokens: sanitizeTokens(parsed.tokens) };
    } catch {
      return null;
    }
  }
}
