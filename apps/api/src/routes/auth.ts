import { hash, verify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { sanitizeTokens, type AuthConfigDto } from '@retro/shared';
import {
  OAUTH_COOKIE, SESSION_COOKIE, createSession, deleteSession, deleteUserSessions,
} from '../auth/sessions';
import { createGuest, createUser, findUserByEmail, resolveExternalLogin, toMeDto, userCount } from '../auth/users';
import type { Ctx } from '../context';
import { identities, users, type User } from '../db/schema';
import { badRequest, forbidden, noContent, notFound, parse, requireUser, unauthorized } from '../lib/http';
import { getSettings } from '../lib/instance';
import { acceptInvite, findValidInvite } from '../lib/invites';

const email = z.string().trim().toLowerCase().email('enter a valid email').max(200);
const password = z.string().min(8, 'use at least 8 characters').max(200);

/** Tiny in-memory limiter: 10 failed logins per email+IP per 15 minutes. */
const failures = new Map<string, { n: number; until: number }>();
function tooManyFailures(key: string): boolean {
  const f = failures.get(key);
  if (!f) return false;
  if (f.until < Date.now()) { failures.delete(key); return false; }
  return f.n >= 10;
}
function recordFailure(key: string) {
  const f = failures.get(key);
  const until = Date.now() + 15 * 60_000;
  failures.set(key, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until });
}

export async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, config } = ctx;

  async function startSession(reply: FastifyReply, user: User, userAgent: string | undefined) {
    const token = await createSession(db, user.id, config.sessionDays, userAgent ?? null);
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: config.sessionDays * 86_400,
    });
  }

  const open = config.authMode === 'none';

  // In no-sign-in mode there are no accounts to create or sign in to.
  app.addHook('onRequest', async (req, reply) => {
    if (!open) return;
    const path = req.url.split('?')[0];
    const blocked = ['/api/auth/signup', '/api/auth/login', '/api/auth/password'].includes(path) ||
      /^\/api\/auth\/[^/]+\/(start|callback)$/.test(path) || path.startsWith('/api/invites/');
    if (blocked) return reply.code(404).send({ error: 'Sign-in is turned off on this site' });
  });

  app.get('/api/auth/config', async (): Promise<AuthConfigDto> => {
    const site = await getSettings(ctx);
    const local = { enabled: ctx.auth.local.enabled, signup: site.signup };
    return {
    mode: config.authMode,
    site: { name: site.siteName, theme: site.theme, features: site.features, maxImageMb: site.maxImageMb, maxVideoMb: site.maxVideoMb },
    publicUrl: config.publicUrl,
    local: open ? { ...local, enabled: false } : local,
    providers: open ? [] : ctx.auth.list(),
    gifSearch: config.giphyApiKey ? 'giphy' : config.tenorApiKey ? 'tenor' : null,
    needsSetup: (await userCount(db)) === 0,
    };
  });

  app.get('/api/auth/me', async req => {
    if (!req.user) throw unauthorized();
    return toMeDto(db, req.user);
  });

  /** No-sign-in mode: gives this browser a guest identity (or returns the one it has). */
  app.post('/api/auth/guest', async (req, reply) => {
    if (!open) throw notFound();
    if (req.user) return toMeDto(db, req.user);
    const guest = await createGuest(db);
    await startSession(reply, guest, req.headers['user-agent']);
    return toMeDto(db, guest);
  });

  /**
   * No-sign-in mode: "I'm one of these people". Switches this browser to an existing guest, so someone on a new
   * device (or after clearing cookies) carries on as themselves. Everyone can do everything in this mode anyway,
   * so there's nothing more to check than that the target is a named guest.
   */
  app.post('/api/auth/guest/claim', async (req, reply) => {
    if (!open) throw notFound();
    const { userId } = parse(z.object({ userId: z.string().min(1).max(64) }), req.body);
    const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!target || !target.guest || !target.name || target.disabled) throw notFound('Person');
    if (req.sessionId) await deleteSession(db, req.sessionId);
    await startSession(reply, target, req.headers['user-agent']);
    return toMeDto(db, target);
  });

  /** No-sign-in mode: "I'm someone else". A fresh, unnamed guest for this browser. */
  app.post('/api/auth/guest/new', async (req, reply) => {
    if (!open) throw notFound();
    if (req.sessionId) await deleteSession(db, req.sessionId);
    const guest = await createGuest(db);
    await startSession(reply, guest, req.headers['user-agent']);
    return toMeDto(db, guest);
  });

  app.post('/api/auth/signup', async (req, reply) => {
    const body = parse(z.object({
      email, password, name: z.string().trim().min(1, 'enter your name').max(100), inviteToken: z.string().optional(),
    }), req.body);
    const local = { enabled: ctx.auth.local.enabled, signup: (await getSettings(ctx)).signup };
    const firstUser = (await userCount(db)) === 0;
    if (!local.enabled && !firstUser) throw forbidden('Email sign-up is turned off');
    if (!firstUser && local.signup !== 'open') {
      if (local.signup === 'closed') throw forbidden('Sign-up is closed; ask an admin to add you');
      if (!body.inviteToken) throw forbidden('Sign-up needs an invite link');
      await findValidInvite(db, body.inviteToken);
    }
    if (await findUserByEmail(db, body.email)) throw badRequest('An account with that email already exists');
    const user = await createUser(db, {
      email: body.email, name: body.name, passwordHash: await hash(body.password),
    }, config.adminEmails);
    if (body.inviteToken) await acceptInvite(db, body.inviteToken, user);
    await startSession(reply, user, req.headers['user-agent']);
    return toMeDto(db, user);
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = parse(z.object({ email, password: z.string().min(1).max(200) }), req.body);
    if (!ctx.auth.local.enabled) throw forbidden('Email sign-in is turned off');
    const key = `${req.ip}|${body.email}`;
    if (tooManyFailures(key)) throw forbidden('Too many attempts, wait 15 minutes');
    const user = await findUserByEmail(db, body.email);
    const ok = !!user?.passwordHash && (await verify(user.passwordHash, body.password));
    if (!user || !ok) {
      recordFailure(key);
      throw unauthorized('Wrong email or password');
    }
    if (user.disabled) throw forbidden('This account is disabled');
    failures.delete(key);
    await startSession(reply, user, req.headers['user-agent']);
    return toMeDto(db, user);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionId) await deleteSession(db, req.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return noContent(reply);
  });

  app.patch('/api/auth/me', async req => {
    const user = requireUser(req);
    const body = parse(z.object({
      name: z.string().trim().min(1).max(100).optional(),
      avatarUrl: z.string().url().max(2000).nullable().optional(),
      prefs: z.object({
        theme: z.object({ preset: z.string().max(40), tokens: z.record(z.string(), z.string()) }).nullable().optional(),
        focusRepliesOpen: z.boolean().optional(),
        replyBoxOpen: z.boolean().optional(),
        composerStyle: z.enum(['full', 'compact', 'button']).optional(),
      }).optional(),
    }), req.body);
    const prefs = { ...user.prefs };
    if (body.prefs && 'theme' in body.prefs) {
      if (body.prefs.theme) prefs.theme = { preset: body.prefs.theme.preset, tokens: sanitizeTokens(body.prefs.theme.tokens) };
      else delete prefs.theme;
    }
    if (typeof body.prefs?.focusRepliesOpen === 'boolean') prefs.focusRepliesOpen = body.prefs.focusRepliesOpen;
    if (typeof body.prefs?.replyBoxOpen === 'boolean') prefs.replyBoxOpen = body.prefs.replyBoxOpen;
    if (body.prefs?.composerStyle) prefs.composerStyle = body.prefs.composerStyle;
    const [updated] = await db.update(users).set({
      name: body.name ?? user.name,
      avatarUrl: body.avatarUrl === undefined ? user.avatarUrl : body.avatarUrl,
      prefs,
    }).where(eq(users.id, user.id)).returning();
    return toMeDto(db, updated);
  });

  app.post('/api/auth/password', async (req, reply) => {
    const user = requireUser(req);
    const body = parse(z.object({ current: z.string().max(200).optional(), next: password }), req.body);
    if (user.passwordHash && !(body.current && (await verify(user.passwordHash, body.current)))) {
      throw badRequest('Current password is wrong');
    }
    await db.update(users).set({ passwordHash: await hash(body.next) }).where(eq(users.id, user.id));
    await deleteUserSessions(db, user.id);
    await startSession(reply, user, req.headers['user-agent']);
    return noContent(reply);
  });

  app.delete('/api/auth/identities/:provider', async (req, reply) => {
    const user = requireUser(req);
    const { provider } = req.params as { provider: string };
    const ids = await db.select().from(identities).where(eq(identities.userId, user.id));
    if (!ids.some(i => i.provider === provider)) throw notFound('Linked login');
    if (ids.length === 1 && !user.passwordHash) throw badRequest('Set a password first, or this account has no way to sign in');
    await db.delete(identities).where(eq(identities.id, ids.find(i => i.provider === provider)!.id));
    return noContent(reply);
  });

  // ---- external providers: /api/auth/<id>/start → provider → /api/auth/<id>/callback ----

  const redirectUri = (id: string) => `${config.publicUrl}/api/auth/${id}/callback`;

  app.get('/api/auth/:provider/start', async (req, reply) => {
    const { provider: id } = req.params as { provider: string };
    const q = req.query as { invite?: string; next?: string };
    const found = await ctx.auth.get(id);
    if (!found) throw notFound('Sign-in provider');
    const started = await found.provider.start(redirectUri(id));
    const next = q.next && q.next.startsWith('/') && !q.next.startsWith('//') ? q.next : '/';
    reply.setCookie(OAUTH_COOKIE, JSON.stringify({ id, state: started.state, secret: started.secret, invite: q.invite ?? null, next }), {
      path: '/api/auth',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      signed: true,
      maxAge: 600,
    });
    return reply.redirect(started.url);
  });

  app.get('/api/auth/:provider/callback', async (req, reply) => {
    const { provider: id } = req.params as { provider: string };
    const fail = (msg: string) => reply.redirect(`/login?error=${encodeURIComponent(msg)}`);
    const raw = req.cookies[OAUTH_COOKIE];
    reply.clearCookie(OAUTH_COOKIE, { path: '/api/auth' });
    const unsigned = raw ? req.unsignCookie(raw) : null;
    if (!unsigned?.valid || !unsigned.value) return fail('Sign-in expired, try again');
    const saved = JSON.parse(unsigned.value) as {
      id: string; state: string; secret: Record<string, string>; invite: string | null; next: string;
    };
    if (saved.id !== id) return fail('Sign-in mixed up providers, try again');
    const found = await ctx.auth.get(id);
    if (!found) return fail('That sign-in provider is not enabled');

    try {
      const url = new URL(req.url, config.publicUrl);
      const profile = await found.provider.finish(url, redirectUri(id), saved);
      const user = await resolveExternalLogin(db, id, profile, {
        currentUser: req.user,
        allowSignup: found.config.allowSignup || !!saved.invite || (await userCount(db)) === 0,
        adminEmails: config.adminEmails,
      });
      if (user.disabled) return fail('This account is disabled');
      if (saved.invite) {
        const teamId = await acceptInvite(db, saved.invite, user).catch(() => null);
        if (teamId && saved.next === '/') saved.next = `/teams/${teamId}`;
      }
      if (!req.user) await startSession(reply, user, req.headers['user-agent']);
      return reply.redirect(saved.next);
    } catch (err) {
      req.log.warn({ err }, 'external sign-in failed');
      return fail(err instanceof Error ? err.message : 'Sign-in failed');
    }
  });
}
