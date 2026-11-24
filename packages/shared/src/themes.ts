import type { ThemeTokens } from './models';

export interface ThemePreset {
  id: string;
  name: string;
  tokens: ThemeTokens;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'light',
    name: 'Light',
    tokens: {
      bg: '#f4f5f7', surface: '#ffffff', surface2: '#eef0f3', text: '#1f2328', muted: '#5f6b7a',
      border: '#d8dde3', accent: '#3b5bdb', accentText: '#ffffff', danger: '#d6336c',
    },
  },
  {
    id: 'dark',
    name: 'Dark',
    tokens: {
      bg: '#16181d', surface: '#20232a', surface2: '#2a2e37', text: '#e6e8eb', muted: '#9aa3ae',
      border: '#363b46', accent: '#748ffc', accentText: '#0b0d12', danger: '#f06595',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    tokens: {
      bg: '#0b1020', surface: '#121a33', surface2: '#1b2547', text: '#dfe6ff', muted: '#8d9bc7',
      border: '#26325c', accent: '#22d3ee', accentText: '#04121a', danger: '#fb7185',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    tokens: {
      bg: '#eef3ec', surface: '#ffffff', surface2: '#e1eadd', text: '#1d2b1f', muted: '#5a6e5c',
      border: '#c9d6c4', accent: '#2f7d4a', accentText: '#ffffff', danger: '#b3261e',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    tokens: {
      bg: '#fff4ec', surface: '#ffffff', surface2: '#ffe6d5', text: '#2d1a12', muted: '#7a5646',
      border: '#f2cdb6', accent: '#e8590c', accentText: '#ffffff', danger: '#c2255c',
    },
  },
  {
    id: 'grape',
    name: 'Grape',
    tokens: {
      bg: '#1a1325', surface: '#241a33', surface2: '#302344', text: '#ece3f7', muted: '#a897c0',
      border: '#3e2f57', accent: '#c084fc', accentText: '#1a0f26', danger: '#fb7185',
    },
  },
  {
    id: 'high-contrast',
    name: 'High contrast',
    tokens: {
      bg: '#000000', surface: '#0a0a0a', surface2: '#1a1a1a', text: '#ffffff', muted: '#d0d0d0',
      border: '#ffffff', accent: '#ffd60a', accentText: '#000000', danger: '#ff5c5c',
    },
  },
];

export const THEME_TOKEN_LABELS: Record<keyof ThemeTokens, string> = {
  bg: 'Background',
  surface: 'Surface',
  surface2: 'Raised surface',
  text: 'Text',
  muted: 'Muted text',
  border: 'Borders',
  accent: 'Accent',
  accentText: 'Text on accent',
  danger: 'Danger',
};

export function presetById(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find(p => p.id === id);
}

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

/** Keeps only valid tokens, filling gaps from the fallback, so a bad stored theme never breaks the page. */
export function sanitizeTokens(input: unknown, fallback: ThemeTokens = THEME_PRESETS[0].tokens): ThemeTokens {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out = { ...fallback };
  for (const key of Object.keys(fallback) as (keyof ThemeTokens)[]) {
    const v = src[key];
    if (isHexColor(v)) out[key] = v.toLowerCase();
  }
  return out;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on the given color. */
export function readableTextOn(hex: string): '#000000' | '#ffffff' {
  return contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff') ? '#000000' : '#ffffff';
}

export function isDarkTheme(tokens: ThemeTokens): boolean {
  return luminance(tokens.bg) < 0.2;
}
