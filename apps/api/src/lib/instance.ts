import { eq } from 'drizzle-orm';
import {
  BUILT_IN_TEMPLATES, DEFAULT_BOARD_SETTINGS, THEME_PRESETS, readableTextOn, sanitizeTokens,
  type InstanceSettings, type ThemePreference,
} from '@retro/shared';
import type { Ctx } from '../context';
import { instanceSettings } from '../db/schema';

const KEY = 'instance';

/**
 * The starting values for instance-wide settings, from the environment (the launch scripts write these to .env).
 * Admins can override any of them on the Customize page; those overrides live in the database.
 */
export function launchDefaults(ctx: Pick<Ctx, 'config' | 'auth'>): InstanceSettings {
  const env = ctx.config.defaults;
  return {
    siteName: env.siteName,
    theme: defaultTheme(env.themePreset, env.accent),
    defaultTemplateId: env.templateId,
    votesPerUser: env.votesPerUser,
    maxVotesPerCard: env.maxVotesPerCard,
    allowAnonymous: env.allowAnonymous,
    signup: ctx.auth.local.signup,
  };
}

/** A preset, optionally with its accent color swapped. null means "leave it to each person" (light/dark). */
export function defaultTheme(presetId: string | null, accent: string | null): ThemePreference | null {
  const preset = presetId ? THEME_PRESETS.find(p => p.id === presetId) : null;
  if (!preset && !accent) return null;
  const base = preset ?? THEME_PRESETS[0];
  if (!accent) return { preset: base.id, tokens: base.tokens };
  const tokens = sanitizeTokens({ ...base.tokens, accent, accentText: readableTextOn(accent) }, base.tokens);
  return { preset: 'custom', tokens };
}

const cache = new WeakMap<object, InstanceSettings>();

/** Launch defaults with the admin's overrides on top. Cached until the next save. */
export async function getSettings(ctx: Ctx): Promise<InstanceSettings> {
  const hit = cache.get(ctx);
  if (hit) return hit;
  const [row] = await ctx.db.select().from(instanceSettings).where(eq(instanceSettings.id, KEY));
  const merged = { ...launchDefaults(ctx), ...cleanOverrides(row?.value ?? {}) };
  cache.set(ctx, merged);
  return merged;
}

export async function getOverrides(ctx: Ctx): Promise<Partial<InstanceSettings>> {
  const [row] = await ctx.db.select().from(instanceSettings).where(eq(instanceSettings.id, KEY));
  return cleanOverrides(row?.value ?? {});
}

/**
 * Saves overrides: keys in `set` are stored (theme: null means "no site theme, each person picks"), keys in
 * `reset` go back to their launch default.
 */
export async function saveOverrides(ctx: Ctx, set: Partial<InstanceSettings>, reset: (keyof InstanceSettings)[] = []) {
  const next: Record<string, unknown> = { ...(await getOverrides(ctx)), ...set };
  for (const k of reset) delete next[k];
  await ctx.db.insert(instanceSettings).values({ id: KEY, value: next })
    .onConflictDoUpdate({ target: instanceSettings.id, set: { value: next, updatedAt: new Date() } });
  cache.delete(ctx);
}

/** Drops anything malformed (from an older version, or hand-edited) so it can't break the app. */
function cleanOverrides(raw: Record<string, unknown>): Partial<InstanceSettings> {
  const out: Partial<InstanceSettings> = {};
  if (typeof raw['siteName'] === 'string' && raw['siteName'].trim()) out.siteName = raw['siteName'].trim().slice(0, 60);
  if (raw['theme'] === null) out.theme = null;
  else if (raw['theme'] && typeof raw['theme'] === 'object') {
    const t = raw['theme'] as { preset?: unknown; tokens?: unknown };
    out.theme = { preset: typeof t.preset === 'string' ? t.preset.slice(0, 40) : 'custom', tokens: sanitizeTokens(t.tokens) };
  }
  if (typeof raw['defaultTemplateId'] === 'string') out.defaultTemplateId = raw['defaultTemplateId'];
  for (const k of ['votesPerUser', 'maxVotesPerCard'] as const) {
    const n = raw[k];
    if (typeof n === 'number' && Number.isInteger(n) && n >= (k === 'votesPerUser' ? 0 : 1) && n <= 100) out[k] = n;
  }
  if (typeof raw['allowAnonymous'] === 'boolean') out.allowAnonymous = raw['allowAnonymous'];
  if (raw['signup'] === 'open' || raw['signup'] === 'invite' || raw['signup'] === 'closed') out.signup = raw['signup'];
  return out;
}

/** Board settings for a new board: built-in defaults, then the instance's, then the team's. */
export function newBoardSettings(site: InstanceSettings, team: { votesPerUser?: number; maxVotesPerCard?: number; anonymousByDefault?: boolean }) {
  return {
    ...DEFAULT_BOARD_SETTINGS,
    votesPerUser: team.votesPerUser ?? site.votesPerUser,
    maxVotesPerCard: team.maxVotesPerCard ?? site.maxVotesPerCard,
    allowAnonymous: site.allowAnonymous,
  };
}

/** Which template a team's boards start from when nobody picks one. */
export function templateFor(site: InstanceSettings, team: { defaultTemplateId?: string }): string {
  return team.defaultTemplateId ?? site.defaultTemplateId ?? BUILT_IN_TEMPLATES[0].id;
}
