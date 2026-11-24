import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AppConfig {
  port: number;
  host: string;
  /** Public origin people open in the browser, used for OAuth redirect URLs. */
  publicUrl: string;
  /** postgres://… for Postgres, pglite:<dir> for an embedded database on disk, memory for a throwaway one. */
  databaseUrl: string;
  sessionSecret: string;
  sessionDays: number;
  cookieSecure: boolean;
  authConfigPath: string;
  /** accounts (default) or none: no sign-in, every visitor gets a guest identity that can do everything */
  authMode: 'accounts' | 'none';
  adminEmails: string[];
  storage: StorageConfig;
  maxUploadBytes: number;
  tenorApiKey: string | null;
  webDist: string | null;
  logLevel: string;
}

export type StorageConfig =
  | { driver: 'local'; dir: string }
  | {
      driver: 's3';
      bucket: string;
      region: string;
      endpoint: string | null;
      accessKeyId: string | null;
      secretAccessKey: string | null;
      forcePathStyle: boolean;
    };

/** config/auth.yaml in the repo, whether the API runs from the repo root or from apps/api (npm run dev). */
/** config/auth.yaml if you made one, otherwise the shipped config/auth.example.yaml. */
function defaultAuthConfig(): string {
  for (const name of ['config/auth.yaml', 'config/auth.example.yaml']) {
    for (const dir of ['.', '..', '../..']) {
      const p = resolve(dir, name);
      if (existsSync(p)) return p;
    }
  }
  return 'config/auth.yaml';
}

/** The built Angular app, found next to the API in the image or in the repo after npm run build. */
function defaultWebDist(): string | null {
  for (const p of ['web', '../web/dist/browser', 'apps/web/dist/browser']) {
    if (existsSync(resolve(p, 'index.html'))) return resolve(p);
  }
  return null;
}

function list(value: string | undefined): string[] {
  return (value ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 8080);
  const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, '');
  const secureSetting = env.COOKIE_SECURE ?? 'auto';
  const storage: StorageConfig =
    env.STORAGE_DRIVER === 's3'
      ? {
          driver: 's3',
          bucket: env.S3_BUCKET ?? 'retro-board',
          region: env.S3_REGION ?? 'us-east-1',
          endpoint: env.S3_ENDPOINT || null,
          accessKeyId: env.S3_ACCESS_KEY_ID || null,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY || null,
          forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
        }
      : { driver: 'local', dir: env.UPLOAD_DIR ?? './data/uploads' };

  let sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 16) {
    sessionSecret = randomBytes(32).toString('hex');
    if (env.NODE_ENV === 'production') {
      console.warn('SESSION_SECRET is missing or short; using a random one, so sign-in state resets on restart');
    }
  }

  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    publicUrl,
    databaseUrl: env.DATABASE_URL ?? 'pglite:./data/pglite',
    sessionSecret,
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    cookieSecure: secureSetting === 'auto' ? publicUrl.startsWith('https://') : secureSetting === 'true',
    authConfigPath: env.AUTH_CONFIG || defaultAuthConfig(),
    authMode: env.AUTH_MODE === 'none' ? 'none' : 'accounts',
    adminEmails: list(env.ADMIN_EMAILS),
    storage,
    maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024,
    tenorApiKey: env.TENOR_API_KEY || null,
    webDist: env.WEB_DIST ?? defaultWebDist(),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
