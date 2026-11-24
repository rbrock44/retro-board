# Architecture

```
 browser ──HTTP /api/*──────────┐
         ──WebSocket /socket.io─┤      ┌──────────────── app container ────────────────┐
         ──GET /* (SPA)─────────┴────▶ │ Fastify                                        │
                                       │  ├─ routes/*    REST, validation, permissions   │
                                       │  ├─ realtime    Socket.IO rooms, presence       │
                                       │  ├─ storage     local disk or S3               │──▶ uploads volume / bucket
                                       │  └─ static      built Angular app              │
                                       └──────────────┬─────────────────────────────────┘
                                                      ▼
                                               Postgres (Drizzle)
```

One process serves everything. The web app is static files; all behavior comes from the API.

## Repo layout

```
packages/shared   Types (DTOs, socket events), templates, theme presets, and pure rules shared by both sides
apps/api          Fastify server: src/routes/*, src/auth/*, src/lib/*, src/db/* ; SQL migrations in drizzle/
apps/web          Angular app: core/ (services), pages/, board/ (the board UI), shared/ (reusable components)
config            auth.example.yaml (copy to auth.yaml)
docs              you are here
```

`@retro/shared` is imported as TypeScript source by both apps (a `paths` alias). The API build bundles it; the
Angular build compiles it.

## The write path

Every change follows the same loop:

1. The browser calls a REST endpoint (`POST /api/cards/:id/vote`)
2. The route checks the session, loads the board and the person's team role, and checks the permission
   (`requireBoard(db, user, boardId, 'vote')`)
3. It writes to Postgres
4. It **broadcasts** the changed entity to the board's Socket.IO room (`board:<id>`)
5. Every open browser, including the one that made the change, applies the event to its store

There is no client-to-server traffic over the socket except `join`, `leave` and `typing`. REST is the only way to
change data, which keeps permission checks in one place and makes everything testable with plain HTTP.

Events carry whole entities (`card.upsert` with the full card), so applying them is a replace-by-id, never a
merge. Missed events are harmless: on reconnect the board reloads.

### Per-viewer shaping

Some fields differ per person: `mine`, `liked`, the author of an anonymous card (hidden from everyone,
including admins, but the author still sees "You (anonymous)"), and reaction `mine` flags. So card events are
shaped **per socket**: `loadCards()` loads the data once and returns a function that builds the DTO for a viewer;
`hub.emitBoard()` calls it for each connected person.

Anonymous cards still store `author_id` (so authors can edit and delete them), but no API response or event ever
includes it for anyone.

## Permissions

Two levels:

| Level | Roles | Stored in |
|---|---|---|
| Instance | `admin`, `user` | `users.role` |
| Team | `admin`, `member`, `viewer` | `team_members.role` |

Instance admins count as team admins everywhere. On a board, the rules live in
`packages/shared/src/rules.ts` so the UI and API agree:

| Ability | Who |
|---|---|
| read | any team role |
| write (cards, replies, uploads) | admin or member, board open, and not locked unless you facilitate |
| vote (like) / react / mark | admin or member, board open (works while locked) |
| facilitate (columns, settings, lock, close) | team admin, or the member who created the board |
| delete board | team admin |

People without a team role get **404**, not 403, so board and team ids don't leak.

## Data model

```
users ─┬─< identities           (provider, subject) per external login
       ├─< sessions             sha256(token) → user, expiry
       └─< team_members >─ teams ─┬─< invites
                                  ├─< templates          custom column layouts (jsonb)
                                  ├─< action_items       owner, due date, status; optional board/card
                                  └─< boards ─┬─< columns          position (fractional key), color
                                              ├─< cards            parent_id (grouping), status, carried_from_id
                                              │    ├─< replies     parent_id (one level of threading)
                                              │    └─< votes       likes: one row per (card, user), count always 1
                                              ├─< attachments      card or reply; storage key or external GIF URL
                                              └─< reactions        target_type + target_id, emoji
```

Notes:

- **Ordering** uses fractional index keys (`a0`, `a0V`, `a1`, …), so moving a card writes one row and concurrent
  moves never renumber each other
- **Grouping** is one level: a card's `parent_id` points at the group head. Dropping a group onto another card
  moves the whole group under the new head. The head holds the group's name (`group_title`)
- **Likes** are one per person per card: `POST /vote` inserts the `(card, user)` row if it isn't there,
  `DELETE /vote` removes it. There is no budget or per-card cap. The table is still called `votes`
- **Carry over**: creating a board copies every team card marked `carry_over` whose `carried_to_board_id` is
  still empty into a new "Carried Over" column, copies their attachments (sharing the stored file), then sets
  `carried_to_board_id` on the originals so each is carried once
- **Instance settings** (site name, default theme, columns, anonymous cards, sign-up rule) are the launch values from
  the environment with admin overrides from the one-row `instance_settings` table on top (`lib/instance.ts`). New
  boards take built-in defaults, then the instance's; a team's default template wins over the instance's. Templates with no team are instance templates
- **Board settings** and **team settings** are `jsonb`, merged over defaults on read, so adding a setting needs
  no migration. Keys that are gone (like the old vote limits) are dropped when they're read

## Auth flow

```
Continue with Google
  → GET /api/auth/google/start      builds PKCE + state + nonce, stores them in a signed 10-minute cookie
  → Google
  → GET /api/auth/google/callback   verifies state/nonce, exchanges the code, reads claims
       → resolveExternalLogin()     linked identity → signed-in user → verified email match → new user
       → session cookie, redirect to the page they started from
```

Providers implement a two-method interface (`start`, `finish`) in `apps/api/src/auth/providers.ts`, and are built
lazily from `config/auth.yaml` so a provider whose discovery URL is down doesn't stop the app from starting.

CSRF: every non-GET `/api/*` request must carry `x-retro-csrf: 1`. Browsers can't add custom headers
cross-origin without a CORS preflight, and CORS is off, so other sites can't forge requests. Cookies are
`SameSite=Lax` as a second layer.

## Web app

- **Zoneless** Angular with signals throughout. Pages are lazy-loaded routes
- `BoardStore` (provided per board page) owns the board state, the socket, filters and every mutation. Its
  `applyEvent()` is a pure function, unit-tested on its own
- Mutations that move things (drag a card, change a mark) update the store immediately and let the server event
  confirm; everything else waits for the event
- **Themes** are nine CSS custom properties (`--bg`, `--surface`, `--accent`, …). `ThemeService` writes them on
  `<html>`; a board theme writes them on the board's root element, so it overrides only inside the board. An
  inline script in `index.html` applies the saved theme before Angular boots, so there's no flash
- **Demo mode**: `AuthService` checks `/api/auth/config` at startup. If nothing answers (or `?demo` / a
  `#demo=` share link is in the address), `DemoService` loads `demo/demo-backend.ts` (a lazy chunk) and `Api`
  sends every request to it instead of `fetch`. It answers the same URLs with the same DTOs, reuses the shared
  rules (permissions, ordering), plays `BoardEvent`s to `BoardStore` in place of the socket, and
  saves its state in `localStorage`. Share links are that state, deflated and base64url-encoded, after `#demo=`
- Markdown is rendered with `marked` and sanitized with DOMPurify using a strict allowlist (no images, no raw
  HTML, no `javascript:` links)
