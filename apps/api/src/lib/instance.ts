import { eq } from 'drizzle-orm';
import {
  BUILT_IN_TEMPLATES, DEFAULT_BOARD_SETTINGS, MAX_UPLOAD_MB_LIMIT, THEME_PRESETS, featureLabel, featuresFromDisabledList, readableTextOn,
  sanitizeTokens, withFeatureDefaults, type FeatureKey, type InstanceSettings, type ThemePreference,
} from '@retro/shared';
import { forbidden } from './http';
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
    allowAnonymous: env.allowAnonymous,
    signup: ctx.auth.local.signup,
    features: featuresFromDisabledList(env.disabledFeatures),
    // MAX_UPLOAD_MB starts both off; admins can set each on their own
    maxImageMb: Math.round(ctx.config.maxUploadBytes / 1048576),
    maxVideoMb: Math.round(ctx.config.maxUploadBytes / 1048576),
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
  const defaults = launchDefaults(ctx);
  const overrides = cleanOverrides(row?.value ?? {});
  // Feature switches merge one by one, so a new feature in a later version starts from its launch default
  const merged = { ...defaults, ...overrides, features: withFeatureDefaults({ ...defaults.features, ...overrides.features }) };
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
  if (typeof raw['allowAnonymous'] === 'boolean') out.allowAnonymous = raw['allowAnonymous'];
  if (raw['signup'] === 'open' || raw['signup'] === 'invite' || raw['signup'] === 'closed') out.signup = raw['signup'];
  if (raw['features'] && typeof raw['features'] === 'object') out.features = raw['features'] as InstanceSettings['features'];
  for (const k of ['maxImageMb', 'maxVideoMb'] as const) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_UPLOAD_MB_LIMIT) out[k] = v;
  }
  return out;
}

/** Refuses with "<Feature> is turned off on this site" when an admin has switched a feature off. */
export async function requireFeature(ctx: Ctx, key: FeatureKey) {
  if (!(await getSettings(ctx)).features[key]) throw forbidden(`${featureLabel(key)} ${key.endsWith('s') ? 'are' : 'is'} turned off on this site`);
}

export async function featureOn(ctx: Ctx, key: FeatureKey): Promise<boolean> {
  return (await getSettings(ctx)).features[key];
}

/** Board settings for a new board: built-in defaults, then the instance's. */
export function newBoardSettings(site: InstanceSettings) {
  return {
    ...DEFAULT_BOARD_SETTINGS,
    allowAnonymous: site.allowAnonymous,
  };
}

/** Which template a team's boards start from when nobody picks one. */
export function templateFor(site: InstanceSettings, team: { defaultTemplateId?: string }): string {
  return team.defaultTemplateId ?? site.defaultTemplateId ?? BUILT_IN_TEMPLATES[0].id;
}
