# Development

## Setup

```bash
nvm use          # Node 24, from .nvmrc
npm install
npm run dev      # API :8080 + Angular :4200 with live reload. Open http://localhost:4200
```

The dev API uses embedded PGlite in `apps/api/data/` (delete the folder to reset) and stores uploads in
`apps/api/data/uploads/`. The Angular dev server proxies `/api` and `/socket.io` to the API
(`apps/web/proxy.conf.json`).

Settings go in `.env` at the repo root (see [configuration.md](configuration.md)). To test an external sign-in
provider locally, set `PUBLIC_URL=http://localhost:4200` so redirects come back through the dev server, and
register `http://localhost:4200/api/auth/<id>/callback` with the provider.

Run one side at a time with `npm run dev -w @retro/api` or `npm start -w @retro/web`.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | API + web in watch mode |
| `npm test` | shared, API, then web tests |
| `npm test -w @retro/api` | API tests only (`npx vitest` in `apps/api` for watch mode) |
| `npm run build` | Production build of web and API |
| `npm start` | Serve the build on :8080 |
| `npm run db:generate` | Create a SQL migration after changing `apps/api/src/db/schema.ts` |
| `./launch.sh` | Build and run the Docker image (`--help` for options) |
| `sh scripts/test-launch.sh` | Test the launcher against a fake Docker (CI runs it with dash and BusyBox) |

## Conventions

- **Shared first.** Types that cross the wire, and any rule both sides need (permissions, ordering,
  theme validation), go in `packages/shared`. Keep it free of Node and Angular imports
- **Every mutation broadcasts.** After writing, a route calls `broadcastCards()`, `broadcastAction()` or
  `ctx.hub.emitBoard()`. A change that isn't broadcast only shows up for others on reload
- **Validate with zod** via `parse(schema, req.body)`; it turns failures into a 400 naming the field
- **Permissions through helpers**: `requireTeam(db, user, teamId, minRole)` and `requireBoard(db, user, boardId, need)`.
  Don't hand-roll role checks in routes
- **Web state** for a board lives in `BoardStore`; components read its signals and call its methods
- **Colors come from tokens.** Use `var(--surface)`, `var(--accent)` etc. in styles, never literal colors, or
  themes won't apply. Global styles live in `apps/web/src/styles.scss`

## Database changes

1. Edit `apps/api/src/db/schema.ts`
2. `npm run db:generate -w @retro/api -- --name short-description`
3. Commit the new file in `apps/api/drizzle/` together with the schema change

Migrations run on every start, on both Postgres and PGlite. Settings-like data (board settings, team settings,
user prefs) are `jsonb` merged over defaults, so new settings usually need no migration.

## Tests

- `packages/shared/src/*.spec.ts` - pure rules
- `apps/api/test/*.spec.ts` - the real app against an in-memory PGlite Postgres, through `app.inject()`.
  `helpers.ts` has `makeApp()`, a cookie-keeping `Client`, `signUp()`, `teamWithBoard()`, `addMember()` and a
  multipart builder. The realtime test starts a real server and connects `socket.io-client`
- `apps/web/src/**/*.spec.ts` - Angular unit tests (Vitest via `ng test`)

CI (`.github/workflows/test.yml`) runs install, `npm test`, `npm run build` and a Docker build on every push to
`master` and every pull request. There is deliberately no lint gate.

## Adding a sign-in provider type

`oidc` already covers most providers. For something else (LDAP, SAML, another OAuth service):

1. Create `apps/api/src/auth/<name>.ts` exporting a factory that returns an `AuthProvider`:

   ```ts
   export interface AuthProvider {
     info: { id: string; name: string; type: string };
     start(redirectUri: string): Promise<{ url: string; state: string; secret: Record<string, string> }>;
     finish(callbackUrl: URL, redirectUri: string, saved: { state: string; secret: Record<string, string> }): Promise<{
       subject: string; email: string | null; emailVerified: boolean; name: string | null; avatarUrl: string | null;
     }>;
   }
   ```

   `start` returns where to send the browser; `state` and `secret` are kept in a signed cookie and handed back to
   `finish`. `finish` must verify the response and return a stable `subject` for the person
2. Add a zod schema for its config next to `oidcSchema` in `providers.ts`, add it to the `providerSchema` union,
   and register the factory in `PROVIDER_FACTORIES`
3. Add the type to `AuthProviderInfo['type']` in `packages/shared/src/models.ts`
4. Document it in [auth.md](auth.md) and `config/auth.example.yaml`

Linking, sign-up rules, sessions and invites are handled for you by `resolveExternalLogin()`.

## Adding a theme preset

Add an entry to `THEME_PRESETS` in `packages/shared/src/themes.ts`. The shared tests check every preset for
readable text contrast (7:1 body text, 3:1 button text), so they'll tell you if the colors don't work.

## Adding a board template

Add to `BUILT_IN_TEMPLATES` in `packages/shared/src/templates.ts`. Teams can also save their own from any board.
