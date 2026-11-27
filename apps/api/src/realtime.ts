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
  close(): Promise<void>;
}

interface SocketData {
  user: User;
  boards: Set<string>;
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
  return { emitBoard() {}, emitUser() {}, async close() {} };
}

export function createHub(server: HttpServer, db: Db, presenceOn: () => Promise<boolean> = async () => true, cookieSecret = ''): Hub {
  const io = new Server(server, { path: '/socket.io', serveClient: false, cors: { origin: false } });

  io.use(async (socket, next) => {
    try {
      const found = await userForToken(db, readCookie(socket.handshake.headers.cookie, SESSION_COOKIE));
      if (!found) return next(new Error('unauthorized'));
      (socket.data as SocketData).user = found.user;
      attachTeamKeys(found.user, allCookies(socket.handshake.headers.cookie), cookieSecret);
      (socket.data as SocketData).boards = new Set();
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
    for (const s of sockets) {
      const u = (s.data as SocketData).user;
      seen.set(u.id, toUserDto(u));
    }
    io.to(room(boardId)).emit(SOCKET_EVENTS.event, { type: 'presence', users: [...seen.values()] } satisfies BoardEvent);
  }

  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;

    socket.on(SOCKET_EVENTS.join, async (boardId: unknown, ack?: (r: { ok: boolean; error?: string }) => void) => {
      try {
        if (typeof boardId !== 'string') throw new Error('bad board id');
        await requireBoard(db, data.user, boardId, 'read');
        await socket.join(room(boardId));
        data.boards.add(boardId);
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

  return {
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
