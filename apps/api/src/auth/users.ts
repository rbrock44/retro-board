import { and, count, eq } from 'drizzle-orm';
import type { MeDto, UserDto } from '@retro/shared';
import type { Db } from '../db';
import { identities, users, type User } from '../db/schema';
import { forbidden } from '../lib/http';
import { newId } from '../lib/ids';
import type { ExternalProfile } from './providers';

export function toUserDto(u: User, opts: { withEmail?: boolean; admin?: boolean } = {}): UserDto {
  const dto: UserDto = {
    id: u.id,
    email: opts.withEmail ? u.email : null,
    name: u.name || 'Guest',
    avatarUrl: u.avatarUrl,
    role: u.role,
  };
  if (u.guest) dto.guest = true;
  if (opts.admin) {
    dto.disabled = u.disabled;
    dto.createdAt = u.createdAt.toISOString();
  }
  return dto;
}

export async function toMeDto(db: Db, u: User): Promise<MeDto> {
  const ids = await db.select().from(identities).where(eq(identities.userId, u.id));
  return {
    ...toUserDto(u, { withEmail: true }),
    prefs: u.prefs ?? {},
    identities: ids.map(i => ({ provider: i.provider, email: i.email })),
    hasPassword: !!u.passwordHash,
    guest: u.guest,
    needsName: u.guest && !u.name,
  };
}

/** AUTH_MODE=none: a visitor with no account. Name stays empty until they enter one. */
export async function createGuest(db: Db): Promise<User> {
  const [u] = await db.insert(users).values({ id: newId(), email: null, name: '', guest: true }).returning();
  return u;
}

export async function userCount(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users);
  return Number(row.n);
}

export async function findUserByEmail(db: Db, email: string): Promise<User | undefined> {
  const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return u;
}

/** The very first account, and anyone listed in ADMIN_EMAILS, becomes an instance admin. */
export async function createUser(
  db: Db,
  input: { email: string | null; name: string; passwordHash?: string | null; avatarUrl?: string | null },
  adminEmails: string[],
): Promise<User> {
  const first = (await userCount(db)) === 0;
  const email = input.email?.toLowerCase() ?? null;
  const [u] = await db.insert(users).values({
    id: newId(),
    email,
    name: input.name.trim().slice(0, 100) || 'Someone',
    passwordHash: input.passwordHash ?? null,
    avatarUrl: input.avatarUrl ?? null,
    role: first || (email && adminEmails.includes(email)) ? 'admin' : 'user',
  }).returning();
  return u;
}

/**
 * Finds the user for an external login, in this order: already-linked identity, the signed-in user
 * (linking a new login), an existing account with the same verified email, else a brand-new account.
 */
export async function resolveExternalLogin(
  db: Db,
  providerId: string,
  profile: ExternalProfile,
  opts: { currentUser: User | null; allowSignup: boolean; adminEmails: string[] },
): Promise<User> {
  const [linked] = await db
    .select({ user: users })
    .from(identities)
    .innerJoin(users, eq(users.id, identities.userId))
    .where(and(eq(identities.provider, providerId), eq(identities.subject, profile.subject)))
    .limit(1);
  if (linked) {
    if (opts.currentUser && opts.currentUser.id !== linked.user.id) {
      throw forbidden('That login is already linked to a different account');
    }
    return linked.user;
  }

  let user: User | null | undefined = opts.currentUser;
  if (!user && profile.email && profile.emailVerified) user = await findUserByEmail(db, profile.email);
  if (!user) {
    if (!opts.allowSignup) throw forbidden('New accounts cannot be created with this provider');
    const emailTaken = profile.email ? await findUserByEmail(db, profile.email) : undefined;
    user = await createUser(db, {
      email: emailTaken ? null : profile.email,
      name: profile.name ?? profile.email?.split('@')[0] ?? 'Someone',
      avatarUrl: profile.avatarUrl,
    }, opts.adminEmails);
  }
  await db.insert(identities).values({
    id: newId(),
    userId: user.id,
    provider: providerId,
    subject: profile.subject,
    email: profile.email,
  });
  if (!user.avatarUrl && profile.avatarUrl) {
    [user] = await db.update(users).set({ avatarUrl: profile.avatarUrl }).where(eq(users.id, user.id)).returning();
  }
  return user;
}
