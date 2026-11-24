import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { invites, teamMembers, teams, type User } from '../db/schema';
import { badRequest, forbidden, notFound } from './http';

export async function findValidInvite(db: Db, token: string) {
  const [row] = await db
    .select({ invite: invites, teamName: teams.name })
    .from(invites)
    .innerJoin(teams, eq(teams.id, invites.teamId))
    .where(eq(invites.token, token))
    .limit(1);
  if (!row || row.invite.revoked) throw notFound('Invite');
  const inv = row.invite;
  if (inv.expiresAt && inv.expiresAt < new Date()) throw badRequest('This invite has expired');
  if (inv.maxUses !== null && inv.uses >= inv.maxUses) throw badRequest('This invite has been used up');
  return { invite: inv, teamName: row.teamName };
}

/** Adds the user to the invite's team. Already a member keeps the higher of the two roles. */
export async function acceptInvite(db: Db, token: string, user: User): Promise<string> {
  const { invite } = await findValidInvite(db, token);
  if (invite.email && invite.email !== user.email) {
    throw forbidden('This invite was sent to a different email address');
  }
  const [existing] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, invite.teamId), eq(teamMembers.userId, user.id)))
    .limit(1);
  if (!existing) {
    await db.insert(teamMembers).values({ teamId: invite.teamId, userId: user.id, role: invite.role });
    await db.update(invites).set({ uses: sql`${invites.uses} + 1` }).where(eq(invites.id, invite.id));
  } else {
    const rank = { viewer: 1, member: 2, admin: 3 };
    if (rank[invite.role] > rank[existing.role]) {
      await db.update(teamMembers).set({ role: invite.role })
        .where(and(eq(teamMembers.teamId, invite.teamId), eq(teamMembers.userId, user.id)));
    }
  }
  return invite.teamId;
}
