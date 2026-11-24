# retro-board

Self-hosted, real-time team retrospective board. npm workspaces monorepo:

- `packages/shared` - DTO types, socket event types, templates, theme presets, and pure rules (permissions, vote
  limits, fractional ordering, theme validation) used by both apps. No Node or Angular imports
- `apps/api` - Node 24 + Fastify 5 + Socket.IO + Drizzle ORM. Postgres in production, PGlite (embedded Postgres)
  for dev and tests. Serves the built web app too
- `apps/web` - Angular 22, standalone components, signals, zoneless, Angular CDK drag and drop

Docs live in `docs/` (architecture, api, auth, configuration, deployment, development). Keep them current when
behavior changes; `docs/api.md` lists every endpoint.

## Commands

- `npm run dev` - API on :8080 and Angular on :4200 (open :4200)
- `npm test` - shared, API and web tests. API tests run the real app on in-memory PGlite
- `npm run build` / `npm start`
- `npm run db:generate -- --name <what>` after editing `apps/api/src/db/schema.ts`; commit the SQL in `apps/api/drizzle/`
- `./launch.sh` / `launch.cmd` - one-command Docker launch. Bare: prompts for settings; with options (`--help`) or `-y`: no prompts. `launch.cmd` runs `launch.ps1`; keep both scripts' options in step

## Rules

- REST is the only way to change data. Every mutating route must broadcast the result
  (`broadcastCards`, `broadcastAction`, `ctx.hub.emitBoard`). Events carry whole entities; clients replace by id
- Card DTOs are shaped per viewer (`loadCards()` returns `(viewerId) => CardDto[]`). Never expose the author of an
  anonymous card, to anyone
- Use `requireTeam` / `requireBoard` for permissions. Non-members get 404, not 403
- Validate bodies with zod through `parse()` from `src/lib/http.ts`
- Every non-GET `/api` request needs header `x-retro-csrf: 1`; the web `Api` service adds it
- Board state on the web lives in `BoardStore` (one per board page); `applyEvent()` stays pure
- Styles use theme tokens only (`var(--bg)`, `var(--surface)`, `var(--accent)`, …), never literal colors
- Uploads are type-checked from bytes (sharp / magic numbers), never from names or claimed MIME types
- Sign-in providers implement `AuthProvider` (`start`/`finish`) in `apps/api/src/auth/`; config in `config/auth.yaml`
- **Setup is a top priority.** `launch.sh` (POSIX sh: test with dash and BusyBox, no bashisms) and `launch.ps1`
  (Windows PowerShell 5.1 compatible) must stay feature-for-feature identical: same questions, options, backup,
  restore and data moves. Pass SQL to `psql` on stdin from PowerShell (it mangles nested quotes), call Windows'
  own `System32\tar.exe`, and in Git Bash avoid native arguments that start with `/`
- Instance settings: launch defaults come from env (`config.defaults`), admin overrides from `instance_settings`;
  read them with `getSettings(ctx)` and add new ones to `InstanceSettings`, `launchDefaults()`, the Customize page,
  `.env.example`, both launchers and the demo backend
- Demo mode (`apps/web/src/app/demo/`) is a full in-browser copy of the API. **When you add or change an endpoint
  the web app calls, update `demo-backend.ts` too**, or the public demo breaks. `demo-backend.spec.ts` covers the core
- `AUTH_MODE=none` makes every visitor a guest (`users.guest`): team admin everywhere via `teamRole()`, sees all
  teams, must have a name before writing (`requireNamed()`). Guest sessions are ignored in `accounts` mode
- Default branch is `master`. CI runs tests, build and a Docker build; no lint gate
