import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * TRUST_PROXY: which hops in front of the app may say who the visitor is (X-Forwarded-For).
 * The default trusts only this machine and private networks (a tunnel, Docker's network, a proxy next to it),
 * so a visitor can't pick their own address by sending the header themselves, which would get around the
 * limits on password guesses. `true` trusts every hop (only behind a proxy that strips the header), a number
 * trusts that many hops, `false` none; anything else is a list of addresses or ranges.
 */
export function parseTrustProxy(value: string | undefined): boolean | number | string {
  const v = (value ?? '').trim();
  if (!v) return 'loopback, linklocal, uniquelocal';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

/** sha256 of each inline <script> in index.html, so the policy allows just those and no others */
function inlineScriptHashes(webRoot: string | null): string[] {
  const file = webRoot && resolve(webRoot, 'index.html');
  if (!file || !existsSync(file)) return [];
  const html = readFileSync(file, 'utf8');
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
}

/**
 * Headers on every response: no framing (so no other site can trick a click on Delete), no type sniffing,
 * and a Content-Security-Policy that only runs this app's own scripts. Images and videos may come from
 * any https address (profile pictures, Giphy/Tenor GIFs). Uploaded files set a stricter policy of their own.
 */
export function securityHeaders(app: FastifyInstance, webRoot: string | null) {
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${inlineScriptHashes(webRoot).join(' ')}`.trim(),
    // Angular puts component styles in <style> tags and binds style attributes
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  app.addHook('onSend', async (_req, reply, payload) => {
    if (!reply.hasHeader('content-security-policy')) reply.header('content-security-policy', csp);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    return payload;
  });
}
