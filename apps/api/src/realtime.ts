import type { Server as HttpServer } from 'node:http';
import { parse as parseCookie } from 'cookie';
import { Server, type Socket } from 'socket.io';
import { SOCKET_EVENTS, type BoardEvent, type UserDto } from '@retro/shared';
import { SESSION_COOKIE, userForToken } from './auth/sessions';
import { toUserDto } from './auth/users';
import type { Db } from './db';
import type { User } from './db/schema';
import { requireBoard } from './lib/access';

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

export function noopHub(): Hub {
  return { emitBoard() {}, emitUser() {}, async close() {} };
}

export function createHub(server: HttpServer, db: Db): Hub {
  const io = new Server(server, { path: '/socket.io', serveClient: false, cors: { origin: false } });

  io.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
      const found = await userForToken(db, cookies[SESSION_COOKIE]);
      if (!found) return next(new Error('unauthorized'));
      (socket.data as SocketData).user = found.user;
      (socket.data as SocketData).boards = new Set();
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  async function presence(boardId: string) {
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

    socket.on(SOCKET_EVENTS.typing, (boardId: unknown, columnId: unknown) => {
      if (typeof boardId !== 'string' || !data.boards.has(boardId)) return;
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
