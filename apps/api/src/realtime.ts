import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { SOCKET_EVENTS, type BoardEvent, type UserDto } from '@retro/shared';
import { SESSION_COOKIE, userForToken } from './auth/sessions';
import { toUserDto } from './auth/users';
import type { Db } from './db';
import type { User } from './db/schema';
import { requireBoard } from './lib/access';
import { attachTeamKeys } from './lib/team-lock';

/** Broadcasts board changes. An event can be one value for everyone or a function shaped per viewer. */
export interface Hub {
  emitBoard(boardId: string, event: BoardEvent | ((viewerId: string) => BoardEvent | null)): void;
  emitUser(boardId: string, userId: string, event: BoardEvent): void;
  /** Checks every live connection's access again (after a removal, a password change, a sign-out, …) */
  recheck(): void;
  close(): Promise<void>;
}

interface SocketData {
  user: User;
  boards: Set<string>;
  /** The boards this person can only watch (viewer role), for the presence list */
  watching: Set<string>;
  /** What the handshake sent, to check the session and team passwords again later */
  token: string | undefined;
  cookies: Record<string, string>;
}

const room = (boardId: string) => `board:${boardId}`;

/** Every cookie in a Cookie header, by name. */
function allCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip a malformed one */ }
  }
  return out;
}

/** Reads one cookie from a Cookie header. Small on purpose: npm may hoist an incompatible `cookie` package. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function noopHub(): Hub {
  return { emitBoard() {}, emitUser() {}, recheck() {}, async close() {} };
}

export function createHub(server: HttpServer, db: Db, presenceOn: () => Promise<boolean> = async () => true, cookieSecret = ''): Hub {
  const io = new Server(server, { path: '/socket.io', serveClient: false, cors: { origin: false } });

  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
      const found = await userForToken(db, token);
      if (!found) return next(new Error('unauthorized'));
      const data = socket.data as SocketData;
      data.user = found.user;
      data.token = token;
      data.cookies = allCookies(socket.handshake.headers.cookie);
      attachTeamKeys(found.user, data.cookies, cookieSecret);
      data.boards = new Set();
      data.watching = new Set();
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  async function presence(boardId: string) {
    if (!(await presenceOn())) {
      io.to(room(boardId)).emit(SOCKET_EVENTS.event, { type: 'presence', users: [] } satisfies BoardEvent);
      return;
    }
    const sockets = await io.in(room(boardId)).fetchSockets();
    const seen = new Map<string, UserDto>();
    const watching = new Set<string>();
    for (const s of sockets) {
      const d = s.data as SocketData;
      seen.set(d.user.id, toUserDto(d.user));
      if (d.watching?.has(boardId)) watching.add(d.user.id);
    }
    io.to(room(boardId)).emit(SOCKET_EVENTS.event, { type: 'presence', users: [...seen.values()], watching: [...watching] } satisfies BoardEvent);
  }

  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;

    socket.on(SOCKET_EVENTS.join, async (boardId: unknown, ack?: (r: { ok: boolean; error?: string }) => void) => {
      try {
        if (typeof boardId !== 'string') throw new Error('bad board id');
        const { role } = await requireBoard(db, data.user, boardId, 'read');
        await socket.join(room(boardId));
        data.boards.add(boardId);
        data.watching ??= new Set();
        if (role === 'viewer') data.watching.add(boardId); else data.watching.delete(boardId);
        ack?.({ ok: true });
        await presence(boardId);
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'join failed' });
      }
    });

    socket.on(SOCKET_EVENTS.leave, async (boardId: unknown) => {
      if (typeof boardId !== 'string') return;
      await socket.leave(room(boardId));
      data.boards.delete(boardId);
      await presence(boardId);
    });

    socket.on(SOCKET_EVENTS.typing, async (boardId: unknown, columnId: unknown) => {
      if (typeof boardId !== 'string' || !data.boards.has(boardId)) return;
      if (!(await presenceOn())) return;
      socket.to(room(boardId)).emit(SOCKET_EVENTS.typing, { user: toUserDto(data.user), columnId });
    });

    socket.on('disconnecting', () => {
      const boards = [...data.boards];
      setTimeout(() => boards.forEach(b => void presence(b)), 0);
    });
  });

  /**
   * Access is checked on joining a board; this checks it again for everyone connected, so someone removed from
   * a team, locked out by a new password or signed out stops getting live changes. They're told (`access.lost`)
   * and their browser reconnects with its current cookies, which brings back whoever still has access.
   */
  async function recheckAll() {
    const touched = new Set<string>();
    for (const socket of io.of('/').sockets.values()) {
      const data = socket.data as SocketData;
      if (!data.boards?.size) continue;
      const found = await userForToken(db, data.token).catch(() => null);
      if (found) {
        data.user = found.user;
        attachTeamKeys(found.user, data.cookies, cookieSecret);
      }
      for (const boardId of [...data.boards]) {
        const role = found ? await requireBoard(db, data.user, boardId, 'read').then(c => c.role, () => null) : null;
        if (role) {
          // a role change (viewer <-> member) shows in the presence list
          data.watching ??= new Set();
          if ((role === 'viewer') !== data.watching.has(boardId)) {
            if (role === 'viewer') data.watching.add(boardId); else data.watching.delete(boardId);
            touched.add(boardId);
          }
          continue;
        }
        data.watching?.delete(boardId);
        await socket.leave(room(boardId));
        data.boards.delete(boardId);
        socket.emit(SOCKET_EVENTS.event, { type: 'access.lost', boardId } satisfies BoardEvent);
        touched.add(boardId);
      }
    }
    for (const boardId of touched) await presence(boardId);
  }
  let recheckQueued = false;

  return {
    recheck() {
      // several changes in a row (e.g. removing a few members) make one pass
      if (recheckQueued) return;
      recheckQueued = true;
      setTimeout(() => { recheckQueued = false; void recheckAll().catch(() => {}); }, 50);
    },
    emitBoard(boardId, event) {
      if (typeof event !== 'function') {
        io.to(room(boardId)).emit(SOCKET_EVENTS.event, event);
        return;
      }
      void io.in(room(boardId)).fetchSockets().then(sockets => {
        for (const s of sockets) {
          const shaped = event((s.data as SocketData).user.id);
          if (shaped) s.emit(SOCKET_EVENTS.event, shaped);
        }
      });
    },
    emitUser(boardId, userId, event) {
      void io.in(room(boardId)).fetchSockets().then(sockets => {
        for (const s of sockets) if ((s.data as SocketData).user.id === userId) s.emit(SOCKET_EVENTS.event, event);
      });
    },
    async close() {
      await io.close();
    },
  };
}
