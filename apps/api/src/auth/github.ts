import { randomBytes } from 'node:crypto';
import type { AuthProvider, GithubConfig } from './providers';

/** GitHub (or GitHub Enterprise Server) OAuth app. GitHub is OAuth 2 only, not OIDC, so it gets its own driver. */
export async function createGithubProvider(c: GithubConfig): Promise<AuthProvider> {
  const base = c.baseUrl.replace(/\/$/, '');
  const api = c.apiUrl.replace(/\/$/, '');
  const headers = (token: string) => ({
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'retro-board',
  });

  return {
    info: { id: c.id, name: c.name, type: 'github' },
    async start(redirectUri) {
      const state = randomBytes(16).toString('base64url');
      const url = new URL(`${base}/login/oauth/authorize`);
      url.searchParams.set('client_id', c.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', 'read:user user:email');
      url.searchParams.set('state', state);
      return { url: url.href, state, secret: {} };
    },
    async finish(callbackUrl, redirectUri, saved) {
      if (callbackUrl.searchParams.get('state') !== saved.state) throw new Error('State mismatch, try again');
      const code = callbackUrl.searchParams.get('code');
      if (!code) throw new Error(callbackUrl.searchParams.get('error_description') ?? 'No code returned');

      const tokenRes = await fetch(`${base}/login/oauth/access_token`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: c.clientId, client_secret: c.clientSecret, code, redirect_uri: redirectUri }),
      });
      const token = (await tokenRes.json()) as { access_token?: string; error_description?: string };
      if (!token.access_token) throw new Error(token.error_description ?? 'GitHub did not return a token');

      const user = (await (await fetch(`${api}/user`, { headers: headers(token.access_token) })).json()) as {
        id: number; login: string; name: string | null; avatar_url: string | null;
      };
      const emails = (await (await fetch(`${api}/user/emails`, { headers: headers(token.access_token) })).json()) as
        { email: string; primary: boolean; verified: boolean }[];
      const primary = Array.isArray(emails) ? emails.find(e => e.primary && e.verified) : undefined;

      return {
        subject: String(user.id),
        email: primary?.email.toLowerCase() ?? null,
        emailVerified: !!primary,
        name: user.name ?? user.login,
        avatarUrl: user.avatar_url,
      };
    },
  };
}
