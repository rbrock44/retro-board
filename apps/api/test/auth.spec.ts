import { afterEach, describe, expect, it } from 'vitest';
import { loadAuthFile, substituteEnv } from '../src/auth/providers';
import { Client, makeApp, signUp, type TestApp } from './helpers';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let t: TestApp;
afterEach(async () => t?.close());

describe('local accounts', () => {
  it('makes the first account an instance admin and later ones regular users', async () => {
    t = await makeApp();
    const cfg = (await new Client(t.app).get('/api/auth/config')).body;
    expect(cfg.needsSetup).toBe(true);
    const first = await signUp(t.app, 'Ada');
    const second = await signUp(t.app, 'Grace');
    expect(first.user.role).toBe('admin');
    expect(second.user.role).toBe('user');
    expect((await new Client(t.app).get('/api/auth/config')).body.needsSetup).toBe(false);
  });

  it('promotes ADMIN_EMAILS on sign-up', async () => {
    t = await makeApp({ env: { ADMIN_EMAILS: 'boss@example.com' } });
    await signUp(t.app, 'First');
    const c = new Client(t.app);
    const r = await c.post('/api/auth/signup', { email: 'Boss@Example.com', name: 'Boss', password: 'longenough1' });
    expect(r.body.role).toBe('admin');
    expect(r.body.email).toBe('boss@example.com');
  });

  it('logs in, reports me, and logs out', async () => {
    t = await makeApp();
    const { email } = await signUp(t.app, 'Ada');
    const c = new Client(t.app);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await c.post('/api/auth/login', { email, password: 'wrong password' })).status).toBe(401);
    expect((await c.post('/api/auth/login', { email, password: 'correct horse battery' })).status).toBe(200);
    const me = await c.get('/api/auth/me');
    expect(me.body.name).toBe('Ada');
    expect(me.body.hasPassword).toBe(true);
    await c.post('/api/auth/logout');
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects duplicate emails and short passwords', async () => {
    t = await makeApp();
    const { email } = await signUp(t.app, 'Ada');
    const c = new Client(t.app);
    expect((await c.post('/api/auth/signup', { email, name: 'X', password: 'longenough1' })).status).toBe(400);
    const short = await c.post('/api/auth/signup', { email: 'x@example.com', name: 'X', password: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/8 characters/);
  });

  it('refuses state-changing requests without the CSRF header', async () => {
    t = await makeApp();
    const { client } = await signUp(t.app, 'Ada');
    const r = await client.request('POST', '/api/teams', { name: 'x' }, { 'x-retro-csrf': '' });
    expect(r.status).toBe(403);
  });

  it('needs an invite when sign-up is invite-only, except for the first account', async () => {
    t = await makeApp({ authFile: { local: { enabled: true, signup: 'invite' } } });
    const owner = await signUp(t.app, 'Owner');
    const c = new Client(t.app);
    expect((await c.post('/api/auth/signup', { email: 'n@example.com', name: 'N', password: 'longenough1' })).status).toBe(403);
    const team = (await owner.client.post('/api/teams', { name: 'T' })).body;
    const invite = (await owner.client.post(`/api/teams/${team.id}/invites`, { role: 'member' })).body;
    const ok = await c.post('/api/auth/signup', { email: 'n@example.com', name: 'N', password: 'longenough1', inviteToken: invite.token });
    expect(ok.status).toBe(200);
    const teams = (await c.get('/api/teams')).body;
    expect(teams.map((x: { id: string }) => x.id)).toEqual([team.id]);
  });

  it('saves a theme preference and drops invalid colors', async () => {
    t = await makeApp();
    const { client } = await signUp(t.app, 'Ada');
    const r = await client.patch('/api/auth/me', { prefs: { theme: { preset: 'custom', tokens: { bg: '#123456', text: 'javascript:alert(1)' } } } });
    expect(r.body.prefs.theme.tokens.bg).toBe('#123456');
    expect(r.body.prefs.theme.tokens.text).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('auth config file', () => {
  it('substitutes environment variables with defaults', () => {
    expect(substituteEnv('a: ${FOO}\nb: ${BAR:-fallback}', { FOO: 'x' })).toBe('a: x\nb: fallback');
  });

  it('parses providers and rejects bad ones with a useful message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retro-auth-'));
    const good = join(dir, 'good.yaml');
    writeFileSync(good, [
      'local: { enabled: true, signup: invite }',
      'providers:',
      '  - { id: google, type: oidc, name: Google, issuer: https://accounts.google.com, clientId: "${GID}", clientSecret: s }',
      '  - { id: github, type: github, name: GitHub, clientId: a, clientSecret: b, enabled: false }',
    ].join('\n'));
    const cfg = loadAuthFile(good, { GID: 'client-123' });
    expect(cfg.local.signup).toBe('invite');
    expect(cfg.providers[0]).toMatchObject({ id: 'google', clientId: 'client-123', scopes: 'openid email profile' });
    expect(cfg.providers[1].enabled).toBe(false);

    const bad = join(dir, 'bad.yaml');
    writeFileSync(bad, 'providers:\n  - { id: Bad Id, type: oidc, name: X, issuer: nope, clientId: a, clientSecret: b }\n');
    expect(() => loadAuthFile(bad)).toThrow(/bad\.yaml: providers\.0\./);
  });

  it('lists only enabled providers on the login page', async () => {
    t = await makeApp({
      authFile: {
        providers: [
          { id: 'kc', type: 'oidc', name: 'Keycloak', enabled: true, issuer: 'http://localhost:1/realms/x', clientId: 'a', clientSecret: 'b', scopes: 'openid', allowSignup: true },
          { id: 'gh', type: 'github', name: 'GitHub', enabled: false, clientId: 'a', clientSecret: 'b', allowSignup: true, baseUrl: 'https://github.com', apiUrl: 'https://api.github.com' },
        ],
      },
    });
    const cfg = (await new Client(t.app).get('/api/auth/config')).body;
    expect(cfg.providers).toEqual([{ id: 'kc', name: 'Keycloak', type: 'oidc' }]);
    const start = await new Client(t.app).get('/api/auth/gh/start');
    expect(start.status).toBe(404);
  });
});
