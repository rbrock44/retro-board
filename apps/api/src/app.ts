import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { createRegistry, loadAuthFile, type AuthFileConfig } from './auth/providers';
import { SESSION_COOKIE, pruneSessions, userForToken } from './auth/sessions';
import type { AppConfig } from './config';
import type { Ctx } from './context';
import { eq } from 'drizzle-orm';
import { openDatabase } from './db';
import { users } from './db/schema';
import { HttpError } from './lib/http';
import { featureOn } from './lib/instance';
import { createStorage, type Storage } from './lib/storage';
import { createHub, noopHub, type Hub } from './realtime';
import { actionRoutes } from './routes/actions';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { boardRoutes } from './routes/boards';
import { cardRoutes } from './routes/cards';
import { mediaRoutes } from './routes/media';
import { teamRoutes } from './routes/teams';

export interface BuildOptions {
  config: AppConfig;
  /** Overrides config/auth.yaml (tests). */
  authFile?: AuthFileConfig;
  storage?: Storage;
  /** Skip Socket.IO (tests that only use inject). */
  realtime?: boolean;
}

/** Requests that change things must carry this header. Browsers cannot add it cross-site without CORS, which is off. */
export const CSRF_HEADER = 'x-retro-csrf';

export async function buildApp(opts: BuildOptions): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const { config } = opts;
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  const authFile = opts.authFile ?? loadAuthFile(config.authConfigPath);
  const database = await openDatabase(config.databaseUrl);
  const hubRef: { current: Hub } = { current: noopHub() };
  const ctx: Ctx = {
    config,
    db: database.db,
    storage: opts.storage ?? createStorage(config.storage),
    auth: createRegistry(authFile),
    get hub() { return hubRef.current; },
  };
  app.log.info({
    authConfig: opts.authFile ? '(inline)' : config.authConfigPath,
    providers: ctx.auth.list().map(p => p.id),
    unconfigured: authFile.unconfigured ?? [],
  }, 'sign-in providers');
  if (config.authMode === 'none') {
    app.log.warn('AUTH_MODE=none: no sign-in. Anyone who can reach this site can see and change everything');
    // Guests from before this release were plain users; in this mode everyone is an admin.
    await database.db.update(users).set({ role: 'admin' }).where(eq(users.guest, true));
  }

  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(multipart);

  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (unsafe && req.headers[CSRF_HEADER] !== '1') {
      return reply.code(403).send({ error: 'Missing CSRF header' });
    }
    const found = await userForToken(ctx.db, req.cookies[SESSION_COOKIE]);
    if (found && (!found.user.guest || config.authMode === 'none')) {
      req.user = found.user;
      req.sessionId = found.sessionId;
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: err.issues[0]?.message ?? 'Bad request' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  for (const routes of [authRoutes, teamRoutes, boardRoutes, cardRoutes, actionRoutes, mediaRoutes, adminRoutes]) {
    await routes(app, ctx);
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || !webRoot) return reply.code(404).send({ error: 'Not found' });
    // Angular routes: hand every other path to index.html.
    return reply.type('text/html').sendFile('index.html');
  });

  const webRoot = config.webDist ? resolve(config.webDist) : null;
  if (webRoot && existsSync(resolve(webRoot, 'index.html'))) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false, index: ['index.html'] });
  }

  if (opts.realtime !== false) {
    hubRef.current = createHub(app.server, ctx.db, () => featureOn(ctx, 'presence'));
  }

  const prune = setInterval(() => void pruneSessions(ctx.db).catch(() => {}), 6 * 3600_000);
  prune.unref();

  app.addHook('onClose', async () => {
    clearInterval(prune);
    await hubRef.current.close().catch(() => {});
    await database.close();
  });

  return { app, ctx };
}
