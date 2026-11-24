import { and, count, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deleteUserSessions } from '../auth/sessions';
import { toUserDto } from '../auth/users';
import type { Ctx } from '../context';
import { users } from '../db/schema';
import { badRequest, noContent, notFound, parse, requireAdmin } from '../lib/http';

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
}
