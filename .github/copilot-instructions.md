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
- `./launch.sh` / `launch.cmd` - one-command Docker launch (creates `.env`, builds, waits for health)

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
- Default branch is `master`. CI runs tests, build and a Docker build; no lint gate
