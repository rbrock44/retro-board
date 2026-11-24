import { TestBed } from '@angular/core/testing';
import { THEME_STORAGE_KEY, ThemeService, themeStyle } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => localStorage.clear());

  it('applies a preset as CSS variables and remembers it', () => {
    const svc = TestBed.inject(ThemeService);
    svc.usePreset('forest');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#2f7d4a');
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!).preset).toBe('forest');
    expect(svc.isDark()).toBe(false);
  });

  it('marks hand-edited themes as custom and ignores bad colors', () => {
    const svc = TestBed.inject(ThemeService);
    svc.usePreset('dark');
    svc.setToken('accent', '#ff00aa');
    expect(svc.current().preset).toBe('custom');
    svc.setToken('text', 'not-a-color');
    expect(svc.current().tokens.text).toMatch(/^#[0-9a-f]{6}$/);
    expect(svc.isDark()).toBe(true);
  });

  it('builds scoped styles with readable danger text', () => {
    const style = themeStyle({ bg: '#000000', surface: '#111111', surface2: '#222222', text: '#ffffff', muted: '#aaaaaa',
      border: '#333333', accent: '#ffff00', accentText: '#000000', danger: '#ffeeee' });
    expect(style['--danger-text']).toBe('#000000');
    expect(style['color-scheme']).toBe('dark');
  });
});
