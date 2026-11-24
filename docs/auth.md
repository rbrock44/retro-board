# Sign-in

Retro Board has real accounts. People sign in with email and password, with any number of external providers, or
both. Providers are configured in `config/auth.yaml`; copy [`config/auth.example.yaml`](../config/auth.example.yaml)
to start. Restart the app (`./launch.sh update`) after editing it.

- [How accounts work](#how-accounts-work)
- [Email and password](#email-and-password)
- [Adding a provider](#adding-a-provider)
- [Google](#google) · [Microsoft Entra ID](#microsoft-entra-id) · [Okta](#okta) · [Keycloak](#keycloak) ·
  [Authentik](#authentik) · [GitHub](#github) · [Any other OIDC provider](#any-other-oidc-provider)
- [Troubleshooting](#troubleshooting)
- [Writing a new kind of provider](#writing-a-new-kind-of-provider)

## How accounts work

- One person is one **user**. A user can have a password, any number of linked external logins, or both
- The **first account** created on a fresh install becomes the instance admin, whatever way it signs in.
  Emails listed in `ADMIN_EMAILS` also become admins when they sign up
- When someone signs in with a provider for the first time, Retro Board looks for:
  1. a user already linked to that exact provider account
  2. the user who is currently signed in (this is how **Settings → Linked sign-ins → Link** works)
  3. an existing user with the same email, **only if the provider says the email is verified**
  4. otherwise it creates a new user, if that provider allows sign-up
- People can link and unlink providers in **Profile & theme → Linked sign-ins**. Unlinking the last way in is
  refused until a password is set
- Sessions are server-side, stored as a hash, in an `HttpOnly`, `SameSite=Lax` cookie. They last `SESSION_DAYS`
  (30) days. Changing a password signs out every other session; disabling a user signs them out everywhere

## Email and password

```yaml
local:
  enabled: true
  signup: open     # open | invite | closed
```

| `signup` | Who can create a password account |
|---|---|
| `open` | Anyone who can reach the site |
| `invite` | Only someone holding a valid team invite link (the link takes them to the sign-up form) |
| `closed` | Nobody. Use providers, or have people sign in with a provider and set a password later |

`enabled: false` hides the email form entirely. The very first account can always be created, so you can't lock
yourself out of a fresh install.

Passwords are hashed with Argon2id. After 10 failed attempts for one email from one IP, sign-in pauses for 15
minutes.

## Adding a provider

Every provider entry has:

| Key | Required | Meaning |
|---|---|---|
| `id` | yes | Lowercase letters, numbers, dashes. Part of the callback URL; don't change it once people use it |
| `type` | yes | `oidc` or `github` |
| `name` | yes | Button label: "Continue with `name`" |
| `clientId`, `clientSecret` | yes | From the provider |
| `enabled` | no | `false` hides it without deleting the config |
| `allowSignup` | no | Default `true`. `false` means only people already linked, or arriving with a team invite, get in |

The **callback (redirect) URL** to register with the provider is always:

```
<PUBLIC_URL>/api/auth/<id>/callback
```

`PUBLIC_URL` in `.env` must be the exact address people use, including `https://` and any port, or the provider
will reject the redirect.

Keep secrets out of the YAML with environment variables, set in `.env`:

```yaml
clientSecret: ${GOOGLE_CLIENT_SECRET}
scopes: ${GOOGLE_SCOPES:-openid email profile}   # with a default
```

## Google

1. Google Cloud console → **APIs & Services → Credentials → Create credentials → OAuth client ID**
2. Application type **Web application**
3. Authorized redirect URI: `https://retro.example.com/api/auth/google/callback`
4. Copy the client id and secret into `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

```yaml
- id: google
  type: oidc
  name: Google
  issuer: https://accounts.google.com
  clientId: ${GOOGLE_CLIENT_ID}
  clientSecret: ${GOOGLE_CLIENT_SECRET}
```

To limit sign-in to your Google Workspace domain, set `allowSignup: false` and invite people, or restrict the
OAuth consent screen to **Internal**.

## Microsoft Entra ID

1. Entra admin center → **App registrations → New registration**
2. Redirect URI (Web): `https://retro.example.com/api/auth/microsoft/callback`
3. **Certificates & secrets → New client secret**
4. **Token configuration → Add optional claim → ID → email** (so email linking works)

```yaml
- id: microsoft
  type: oidc
  name: Microsoft
  issuer: https://login.microsoftonline.com/<tenant-id>/v2.0   # or /common/v2.0 for any Microsoft account
  clientId: ${MS_CLIENT_ID}
  clientSecret: ${MS_CLIENT_SECRET}
```

## Okta

1. Okta admin → **Applications → Create App Integration → OIDC → Web Application**
2. Sign-in redirect URI: `https://retro.example.com/api/auth/okta/callback`
3. Assign the people or groups who may use it

```yaml
- id: okta
  type: oidc
  name: Okta
  issuer: https://your-org.okta.com
  clientId: ${OKTA_CLIENT_ID}
  clientSecret: ${OKTA_CLIENT_SECRET}
```

## Keycloak

1. Realm → **Clients → Create client**, type OpenID Connect, **Client authentication on**
2. Valid redirect URIs: `https://retro.example.com/api/auth/keycloak/callback`
3. **Credentials** tab → copy the client secret

```yaml
- id: keycloak
  type: oidc
  name: Company SSO
  issuer: https://sso.example.com/realms/<realm>
  clientId: retro-board
  clientSecret: ${KEYCLOAK_CLIENT_SECRET}
```

For a Keycloak running in Docker on the same machine during testing, plain `http://` issuers are accepted.

## Authentik

1. **Applications → Providers → Create → OAuth2/OpenID Provider**, client type Confidential
2. Redirect URI: `https://retro.example.com/api/auth/authentik/callback`
3. Create an Application using that provider

```yaml
- id: authentik
  type: oidc
  name: Authentik
  issuer: https://auth.example.com/application/o/<application-slug>/
  clientId: ${AUTHENTIK_CLIENT_ID}
  clientSecret: ${AUTHENTIK_CLIENT_SECRET}
```

## GitHub

GitHub is OAuth 2, not OpenID Connect, so it has its own `type`.

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
   (or the same under an organization)
2. Authorization callback URL: `https://retro.example.com/api/auth/github/callback`
3. Generate a client secret

```yaml
- id: github
  type: github
  name: GitHub
  clientId: ${GITHUB_CLIENT_ID}
  clientSecret: ${GITHUB_CLIENT_SECRET}
```

Only the person's **primary, verified** email is used for linking. For **GitHub Enterprise Server** add
`baseUrl: https://github.example.com` and `apiUrl: https://github.example.com/api/v3`.

## Any other OIDC provider

Auth0, Zitadel, Ping, OneLogin, AWS Cognito, GitLab, Dex and others all work with `type: oidc`. You need the
**issuer** URL, the one that serves `<issuer>/.well-known/openid-configuration`. Scopes default to
`openid email profile`; override with `scopes:` if your provider needs something else.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Provider says the redirect URI doesn't match | `PUBLIC_URL` differs from what you registered (http vs https, port, trailing path) |
| "Sign-in expired, try again" | More than 10 minutes on the provider's page, or cookies blocked. The sign-in cookie lives 10 minutes |
| "New accounts cannot be created with this provider" | `allowSignup: false`; send the person a team invite link first |
| A second account was created instead of linking | The provider didn't mark the email verified. Sign in the old way, then **Link** from Settings |
| The provider button is missing | `enabled: false`, a YAML error (check `./launch.sh logs`), or the app wasn't restarted |
| The app won't start after editing `auth.yaml` | The log names the bad key, e.g. `config/auth.yaml: providers.0.issuer Invalid url` |

## Writing a new kind of provider

Anything that can turn a browser redirect into a verified identity can be a provider (LDAP with a login form,
SAML, a different OAuth service). See [development.md](development.md#adding-a-sign-in-provider-type).
