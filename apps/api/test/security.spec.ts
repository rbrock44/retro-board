import { afterEach, describe, expect, it } from 'vitest';
import { parseTrustProxy } from '../src/lib/security';
import { addMember, makeApp, teamWithBoard, type TestApp } from './helpers';

let t: TestApp;
afterEach(async () => t?.close());

describe('security', () => {
  it('sends the security headers, leaving uploads their stricter policy', async () => {
    t = await makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/auth/config' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toMatch(/script-src 'self'/);
  });

  it("doesn't let a visitor pick their own address to get more password guesses", async () => {
    t = await makeApp();
    const { owner, team } = await teamWithBoard(t.app);
    const member = await addMember(t.app, owner.client, team.id, 'member');
    await owner.client.put(`/api/teams/${team.id}/password`, { password: 'sprint' });

    // straight from the internet, a new made-up X-Forwarded-For on every try
    const guess = (i: number, remoteAddress: string, xff: string) => t.app.inject({
      method: 'POST', url: `/api/teams/${team.id}/unlock`, payload: { password: `wrong${i}` }, remoteAddress,
      headers: { 'x-retro-csrf': '1', cookie: member.client.cookie, 'x-forwarded-for': xff },
    });
    const codes: number[] = [];
    for (let i = 0; i < 9; i++) codes.push((await guess(i, '203.0.113.5', `10.0.0.${i}`)).statusCode);
    expect(codes.slice(0, 8).every(c => c === 400)).toBe(true);
    expect(codes[8]).toBe(429);

    // through a tunnel on a private network, the address it reports is the one that counts
    expect((await guess(0, '172.18.0.1', '1.2.3.4, 198.51.100.7')).statusCode).toBe(400);
  });

  it('reads TRUST_PROXY', () => {
    expect(parseTrustProxy(undefined)).toBe('loopback, linklocal, uniquelocal');
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
    const twoHops = parseTrustProxy('2') as (address: string, hop: number) => boolean;
    expect([0, 1, 2].map(hop => twoHops('10.0.0.1', hop))).toEqual([true, true, false]);
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
  });
});
