import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';
import { actionItems, boards, cards, teamMembers } from '../db/schema';
import { requireTeam } from '../lib/access';
import { badRequest, noContent, notFound, parse, requireUser, zId } from '../lib/http';
import { newId } from '../lib/ids';
import { loadActions } from '../lib/serialize';
import { broadcastAction } from './boards';

const zDue = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').nullable();

export async function actionRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  async function checkOwner(teamId: string, ownerId: string | null | undefined) {
    if (!ownerId) return;
    const [m] = await db.select().from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, ownerId)));
    if (!m) throw badRequest('The owner must be on the team');
  }

  app.post('/api/teams/:teamId/actions', async req => {
    const user = requireUser(req);
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId, 'member');
    const body = parse(z.object({
      title: z.string().trim().min(1).max(300),
      ownerId: zId.nullable().optional(),
      dueDate: zDue.optional(),
      boardId: zId.nullable().optional(),
      cardId: zId.nullable().optional(),
    }), req.body);
    let boardId = body.boardId ?? null;
    if (body.cardId) {
      const [c] = await db.select().from(cards).where(eq(cards.id, body.cardId));
      if (!c) throw notFound('Card');
      boardId = c.boardId;
    }
    if (boardId) {
      const [b] = await db.select().from(boards).where(eq(boards.id, boardId));
      if (!b || b.teamId !== team.id) throw badRequest('That board belongs to another team');
    }
    await checkOwner(team.id, body.ownerId);
    const id = newId();
    await db.insert(actionItems).values({
      id, teamId: team.id, boardId, cardId: body.cardId ?? null, title: body.title,
      ownerId: body.ownerId ?? null, dueDate: body.dueDate ?? null, createdBy: user.id,
    });
    await broadcastAction(ctx, team.id, id);
    return (await loadActions(db, eq(actionItems.id, id)))[0];
  });

  app.patch('/api/actions/:actionId', async req => {
    const user = requireUser(req);
    const [a] = await db.select().from(actionItems).where(eq(actionItems.id, (req.params as { actionId: string }).actionId));
    if (!a) throw notFound('Action item');
    await requireTeam(db, user, a.teamId, 'member');
    const body = parse(z.object({
      title: z.string().trim().min(1).max(300).optional(),
      ownerId: zId.nullable().optional(),
      dueDate: zDue.optional(),
      status: z.enum(['open', 'done']).optional(),
    }), req.body);
    await checkOwner(a.teamId, body.ownerId);
    const status = body.status ?? a.status;
    await db.update(actionItems).set({
      title: body.title ?? a.title,
      ownerId: body.ownerId !== undefined ? body.ownerId : a.ownerId,
      dueDate: body.dueDate !== undefined ? body.dueDate : a.dueDate,
      status,
      completedAt: status === 'done' ? a.completedAt ?? new Date() : null,
    }).where(eq(actionItems.id, a.id));
    await broadcastAction(ctx, a.teamId, a.id);
    return (await loadActions(db, eq(actionItems.id, a.id)))[0];
  });

  app.delete('/api/actions/:actionId', async (req, reply) => {
    const user = requireUser(req);
    const [a] = await db.select().from(actionItems).where(eq(actionItems.id, (req.params as { actionId: string }).actionId));
    if (!a) throw notFound('Action item');
    await requireTeam(db, user, a.teamId, 'member');
    await db.delete(actionItems).where(eq(actionItems.id, a.id));
    await broadcastAction(ctx, a.teamId, a.id, true);
    return noContent(reply);
  });
}
