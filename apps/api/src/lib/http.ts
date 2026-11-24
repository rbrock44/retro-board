import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { User } from '../db/schema';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const unauthorized = (msg = 'Sign in first') => new HttpError(401, msg);
export const forbidden = (msg = 'You do not have access to that') => new HttpError(403, msg);
export const notFound = (what = 'That') => new HttpError(404, `${what} was not found`);
export const conflict = (msg: string) => new HttpError(409, msg);

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    sessionId: string | null;
  }
}

export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Writing a card or reply: guests (no-sign-in mode) have to give a name first. */
export function requireNamed(req: FastifyRequest): User {
  const user = requireUser(req);
  if (user.guest && !user.name) throw badRequest('Enter your name first');
  return user;
}

export function requireAdmin(req: FastifyRequest): User {
  const user = requireUser(req);
  if (user.role !== 'admin') throw forbidden('Instance admins only');
  return user;
}

/** Parses a request part with zod and turns failures into a 400 that names the bad field. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
    throw badRequest(`${where}${issue.message}`);
  }
  return result.data;
}

export const zId = z.string().min(1).max(64);
export const zColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb color').transform(s => s.toLowerCase());
export const zPosition = z.string().min(1).max(200).regex(/^[0-9A-Za-z]+$/, 'invalid position');
export const zBody = z.string().max(10000);

export function noContent(reply: FastifyReply) {
  return reply.code(204).send();
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
