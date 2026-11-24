import * as client from 'openid-client';
import type { AuthProvider } from './providers';
import type { OidcConfig } from './providers';

/** Any OpenID Connect issuer: Google, Microsoft Entra, Okta, Keycloak, Authentik, Auth0, Zitadel, … */
export async function createOidcProvider(c: OidcConfig): Promise<AuthProvider> {
  const issuer = new URL(c.issuer);
  const config = await client.discovery(
    issuer,
    c.clientId,
    c.clientSecret,
    undefined,
    issuer.protocol === 'http:' ? { execute: [client.allowInsecureRequests] } : undefined,
  );

  return {
    info: { id: c.id, name: c.name, type: 'oidc' },
    async start(redirectUri) {
      const verifier = client.randomPKCECodeVerifier();
      const state = client.randomState();
      const nonce = client.randomNonce();
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: c.scopes,
        code_challenge: await client.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      });
      return { url: url.href, state, secret: { verifier, nonce } };
    },
    async finish(callbackUrl, _redirectUri, saved) {
      const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: saved.secret.verifier,
        expectedState: saved.state,
        expectedNonce: saved.secret.nonce,
      });
      const claims = tokens.claims();
      if (!claims) throw new Error('The provider did not return an ID token');
      let info: Record<string, unknown> = { ...claims };
      if (!claims.email || !claims.name) {
        try {
          info = { ...info, ...(await client.fetchUserInfo(config, tokens.access_token, claims.sub)) };
        } catch {
          // userinfo is optional; the ID token is enough
        }
      }
      const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
      return {
        subject: claims.sub,
        email: str(info.email)?.toLowerCase() ?? null,
        emailVerified: info.email_verified === true || info.email_verified === 'true',
        name: str(info.name) ?? str(info.preferred_username) ?? str(info.given_name),
        avatarUrl: str(info.picture),
      };
    },
  };
}
