import { readFileSync, existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { AuthProviderInfo } from '@retro/shared';

/**
 * What every external login provider has to do. To add a new kind (LDAP, SAML, …) write a factory
 * that returns one of these and register its `type` in PROVIDER_FACTORIES below.
 */
export interface AuthProvider {
  info: AuthProviderInfo;
  /** Builds the URL to send the browser to, plus whatever must survive until the callback. */
  start(redirectUri: string): Promise<{ url: string; state: string; secret: Record<string, string> }>;
  /** Turns the callback URL into a verified profile. */
  finish(callbackUrl: URL, redirectUri: string, saved: { state: string; secret: Record<string, string> }): Promise<ExternalProfile>;
}

export interface ExternalProfile {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

const providerBase = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'ids are lowercase letters, numbers and dashes'),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  /** Create an account on first login. Off means only already-linked or invited users get in. */
  allowSignup: z.boolean().default(true),
});

const oidcSchema = providerBase.extend({
  type: z.literal('oidc'),
  issuer: z.string().url(),
  scopes: z.string().default('openid email profile'),
});

const githubSchema = providerBase.extend({
  type: z.literal('github'),
  /** For GitHub Enterprise Server, e.g. https://github.example.com */
  baseUrl: z.string().url().default('https://github.com'),
  apiUrl: z.string().url().default('https://api.github.com'),
});

const providerSchema = z.discriminatedUnion('type', [oidcSchema, githubSchema]);
export type ProviderConfig = z.infer<typeof providerSchema>;

export const authFileSchema = z.object({
  local: z.object({
    enabled: z.boolean().default(true),
    /** open: anyone can sign up; invite: only with an invite link; closed: admins add people */
    signup: z.enum(['open', 'invite', 'closed']).default('open'),
  }).default({ enabled: true, signup: 'open' }),
  providers: z.array(providerSchema).default([]),
});
export type AuthFileConfig = z.infer<typeof authFileSchema>;

/** Replaces ${VAR} and ${VAR:-default} with environment values so secrets can stay out of the file. */
export function substituteEnv(text: string, env: NodeJS.ProcessEnv = process.env): string {
  return text.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g, (_, name: string, fallback?: string) =>
    env[name] ?? fallback ?? '');
}

export function loadAuthFile(path: string, env: NodeJS.ProcessEnv = process.env): AuthFileConfig {
  if (!existsSync(path)) return authFileSchema.parse({});
  const raw = parseYaml(substituteEnv(readFileSync(path, 'utf8'), env)) ?? {};
  const result = authFileSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`${path}: ${issue.path.join('.')} ${issue.message}`);
  }
  return result.data;
}

type Factory = (config: ProviderConfig) => Promise<AuthProvider>;

const PROVIDER_FACTORIES: Record<ProviderConfig['type'], Factory> = {
  oidc: async c => (await import('./oidc')).createOidcProvider(c as z.infer<typeof oidcSchema>),
  github: async c => (await import('./github')).createGithubProvider(c as z.infer<typeof githubSchema>),
};

export interface ProviderRegistry {
  local: AuthFileConfig['local'];
  list(): AuthProviderInfo[];
  get(id: string): Promise<{ provider: AuthProvider; config: ProviderConfig } | null>;
}

/** Providers are built lazily (OIDC discovery hits the network) and cached once they work. */
export function createRegistry(file: AuthFileConfig): ProviderRegistry {
  const enabled = file.providers.filter(p => p.enabled);
  const cache = new Map<string, Promise<AuthProvider>>();
  return {
    local: file.local,
    list: () => enabled.map(p => ({ id: p.id, name: p.name, type: p.type })),
    async get(id) {
      const config = enabled.find(p => p.id === id);
      if (!config) return null;
      let pending = cache.get(id);
      if (!pending) {
        pending = PROVIDER_FACTORIES[config.type](config);
        cache.set(id, pending);
        pending.catch(() => cache.delete(id));
      }
      return { provider: await pending, config };
    },
  };
}

export type OidcConfig = z.infer<typeof oidcSchema>;
export type GithubConfig = z.infer<typeof githubSchema>;
