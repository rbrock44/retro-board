import { and, count, eq, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BUILT_IN_TEMPLATES, type InstanceSettings, type InstanceSettingsAdminDto, type TemplateDto } from '@retro/shared';
import { getOverrides, getSettings, launchDefaults, saveOverrides } from '../lib/instance';
import { newId } from '../lib/ids';
import { badRequest, noContent, notFound, parse, requireAdmin, zColor } from '../lib/http';
import { deleteUserSessions } from '../auth/sessions';
import { toUserDto } from '../auth/users';
import type { Ctx } from '../context';
import { templates, users } from '../db/schema';


/** Instance-level administration. Team-level roles live in routes/teams.ts. */
export async function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  app.get('/api/admin/users', async req => {
    requireAdmin(req);
    const rows = await db.select().from(users).orderBy(users.name);
    return rows.map(u => toUserDto(u, { withEmail: true, admin: true }));
  });

  app.patch('/api/admin/users/:userId', async (req, reply) => {
    const me = requireAdmin(req);
    const { userId } = req.params as { userId: string };
    const body = parse(z.object({ role: z.enum(['admin', 'user']).optional(), disabled: z.boolean().optional() }), req.body);
    const [target] = await db.select().from(users).where(eq(users.id, userId));
    if (!target) throw notFound('User');
    const demoting = (body.role === 'user' && target.role === 'admin') || (body.disabled && target.role === 'admin');
    if (demoting) {
      const [others] = await db.select({ n: count() }).from(users)
        .where(and(eq(users.role, 'admin'), eq(users.disabled, false), ne(users.id, userId)));
      if (Number(others.n) === 0) throw badRequest('There must be at least one active admin');
    }
    if (target.id === me.id && body.disabled) throw badRequest('You cannot disable yourself');
    await db.update(users).set({ role: body.role ?? target.role, disabled: body.disabled ?? target.disabled }).where(eq(users.id, userId));
    if (body.disabled) await deleteUserSessions(db, userId);
    return noContent(reply);
  });

  // ---- Customize: instance-wide settings ----

  const instanceTemplates = async (): Promise<TemplateDto[]> =>
    (await db.select().from(templates).where(isNull(templates.teamId)).orderBy(templates.name))
      .map(t => ({ id: t.id, name: t.name, description: t.description, columns: t.columns, builtIn: false, instance: true }));

  const adminDto = async (): Promise<InstanceSettingsAdminDto> => ({
    settings: await getSettings(ctx),
    launchDefaults: launchDefaults(ctx),
    overridden: Object.keys(await getOverrides(ctx)) as (keyof InstanceSettings)[],
    templates: [...(await instanceTemplates()), ...BUILT_IN_TEMPLATES],
    storage: {
      location: ctx.config.dataLocation,
      database: ctx.config.databaseUrl.startsWith('postgres') ? 'Postgres' : ctx.config.databaseUrl,
      uploads: ctx.config.storage.driver === 's3' ? `S3 bucket ${ctx.config.storage.bucket}` : ctx.config.storage.dir,
    },
  });

  app.get('/api/admin/settings', async req => {
    requireAdmin(req);
    return adminDto();
  });

  const zTheme = z.object({ preset: z.string().max(40), tokens: z.record(z.string(), z.string()) });

  app.patch('/api/admin/settings', async req => {
    requireAdmin(req);
    const body = parse(z.object({
      siteName: z.string().trim().min(1, 'give the site a name').max(60).optional(),
      theme: zTheme.nullable().optional(),
      defaultTemplateId: z.string().max(64).optional(),
      allowAnonymous: z.boolean().optional(),
      signup: z.enum(['open', 'invite', 'closed']).optional(),
      /** Settings to put back to their launch default */
      reset: z.array(z.enum(['siteName', 'theme', 'defaultTemplateId', 'allowAnonymous', 'signup'])).default([]),
    }), req.body);
    const { reset, ...set } = body;
    if (set.defaultTemplateId && !(await adminDto()).templates.some(t => t.id === set.defaultTemplateId)) {
      throw badRequest('Unknown template');
    }
    const clean = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined)) as Partial<InstanceSettings>;
    await saveOverrides(ctx, clean, reset);
    return adminDto();
  });

  /** Templates every team can pick from, alongside the built-in ones and their own. */
  app.post('/api/admin/templates', async req => {
    requireAdmin(req);
    const body = parse(z.object({
      name: z.string().trim().min(1).max(80),
      description: z.string().max(300).default(''),
      columns: z.array(z.object({ title: z.string().trim().min(1).max(80), color: zColor, description: z.string().max(300).optional() })).min(1).max(12),
    }), req.body);
    const [t] = await db.insert(templates).values({ id: newId(), teamId: null, ...body }).returning();
    return { id: t.id, name: t.name, description: t.description, columns: t.columns, builtIn: false, instance: true } satisfies TemplateDto;
  });
}
