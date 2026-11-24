import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import type { AuthFileConfig } from '../src/auth/providers';
import { loadConfig } from '../src/config';
import type { Ctx } from '../src/context';

export interface TestApp {
  app: FastifyInstance;
  ctx: Ctx;
  uploads: string;
  close(): Promise<void>;
}

export async function makeApp(opts: { authFile?: Partial<AuthFileConfig>; realtime?: boolean; env?: Record<string, string> } = {}): Promise<TestApp> {
  const uploads = mkdtempSync(join(tmpdir(), 'retro-uploads-'));
  const config = loadConfig({
    DATABASE_URL: 'memory',
    LOG_LEVEL: 'silent',
    SESSION_SECRET: 'test-secret-test-secret',
    UPLOAD_DIR: uploads,
    AUTH_CONFIG: join(uploads, 'none.yaml'),
    PORT: '0',
    ...opts.env,
  });
  const { app, ctx } = await buildApp({
    config,
    realtime: opts.realtime ?? false,
    authFile: {
      local: { enabled: true, signup: 'open' },
      providers: [],
      ...opts.authFile,
    } as AuthFileConfig,
  });
  await app.ready();
  return {
    app,
    ctx,
    uploads,
    async close() {
      await app.close();
      rmSync(uploads, { recursive: true, force: true });
    },
  };
}

/** A signed-in browser: keeps its cookie and sends the CSRF header like the web client does. */
export class Client {
  cookie = '';
  constructor(private app: FastifyInstance) {}

  async request<T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method: method as 'GET',
      url,
      payload: body === undefined ? undefined : (body as object),
      headers: { 'x-retro-csrf': '1', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    });
    const set = res.headers['set-cookie'];
    for (const c of Array.isArray(set) ? set : set ? [set] : []) {
      if (c.startsWith('rb_session=')) this.cookie = c.split(';')[0];
    }
    let json: T | undefined;
    try { json = res.json() as T; } catch { json = undefined; }
    return { status: res.statusCode, body: json as T, raw: res };
  }

  get<T = any>(url: string) { return this.request<T>('GET', url); }
  post<T = any>(url: string, body?: unknown) { return this.request<T>('POST', url, body ?? {}); }
  patch<T = any>(url: string, body: unknown) { return this.request<T>('PATCH', url, body); }
  del<T = any>(url: string) { return this.request<T>('DELETE', url); }
}

let n = 0;
export async function signUp(app: FastifyInstance, name = `User ${++n}`, extra: Record<string, unknown> = {}) {
  const client = new Client(app);
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${n++}@example.com`;
  const res = await client.post('/api/auth/signup', { email, name, password: 'correct horse battery', ...extra });
  if (res.status !== 200) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { client, user: res.body, email };
}

/** Admin creates a team and a board; returns everything a test usually needs. */
export async function teamWithBoard(app: FastifyInstance, boardBody: Record<string, unknown> = {}) {
  const owner = await signUp(app, 'Owner');
  const team = (await owner.client.post('/api/teams', { name: 'Platform' })).body;
  const board = (await owner.client.post(`/api/teams/${team.id}/boards`, { title: 'Sprint 1', templateId: 'start-stop-continue', ...boardBody })).body;
  const state = (await owner.client.get(`/api/boards/${board.id}`)).body;
  return { owner, team, board, state };
}

export async function addMember(app: FastifyInstance, owner: Client, teamId: string, role: 'admin' | 'member' | 'viewer' = 'member', name?: string) {
  const invite = (await owner.post(`/api/teams/${teamId}/invites`, { role })).body;
  const person = await signUp(app, name ?? `${role} person`);
  const r = await person.client.post(`/api/invites/by-token/${invite.token}/accept`);
  if (r.status !== 200) throw new Error(`accept failed ${r.status}`);
  return person;
}

export function multipart(field: string, filename: string, mime: string, data: Buffer) {
  const boundary = '----retro' + Math.random().toString(16).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}
