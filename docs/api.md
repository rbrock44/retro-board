# API reference

JSON over HTTP under `/api`, plus Socket.IO at `/socket.io`. Request and response types are in
[`packages/shared/src/models.ts`](../packages/shared/src/models.ts).

**Every request that changes data needs the header `x-retro-csrf: 1`.** Authentication is the `rb_session`
cookie set by sign-in. Errors are `{ "error": "message" }` with a 4xx/5xx status. 404 is returned both for things
that don't exist and things you can't see.

```bash
# example with curl
curl -c jar -H 'x-retro-csrf: 1' -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"…"}' http://localhost:8080/api/auth/login
curl -b jar http://localhost:8080/api/teams
```

## Auth

| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `/api/auth/config` | | `mode` (`accounts` or `none`), `site` (name, theme, `features` switched on), enabled sign-in methods, whether GIF search is on, `needsSetup` on a fresh install |
| POST | `/api/auth/guest` | | `AUTH_MODE=none` only: gives the browser a guest session (or returns the current one) |
| POST | `/api/auth/guest/claim` | `userId` | `AUTH_MODE=none` only: "that's me", switch this browser to an existing named guest |
| POST | `/api/auth/guest/new` | | `AUTH_MODE=none` only: start over as a new, unnamed guest |
| POST | `/api/auth/signup` | `email, name, password, inviteToken?` | Subject to `local.signup` |
| POST | `/api/auth/login` | `email, password` | |
| POST | `/api/auth/logout` | | |
| GET | `/api/auth/me` | | Profile, prefs (theme), linked providers |
| PATCH | `/api/auth/me` | `name?, avatarUrl?, prefs?: { theme?: {preset, tokens} \| null, focusRepliesOpen?, replyBoxOpen?, composerStyle?: 'full'\|'compact'\|'button' }` | |
| POST | `/api/auth/password` | `current?, next` | `current` required when a password exists. Signs out other sessions |
| DELETE | `/api/auth/identities/:provider` | | Unlink a provider |
| GET | `/api/auth/:provider/start` | `?invite=&next=` | Browser redirect to the provider |
| GET | `/api/auth/:provider/callback` | | Provider redirects here |

## Teams

| Method | Path | Body / query | Role |
|---|---|---|---|
| GET | `/api/teams` | `?all=1` (instance admins) | |
| POST | `/api/teams` | `name, description?` | any user; creator becomes admin |
| GET / PATCH / DELETE | `/api/teams/:teamId` | PATCH: `name?, description?, settings?{defaultTemplateId, allowAnonymous, locked, theme}`. `allowAnonymous`, `locked` and `theme` are copied onto the team's open boards (sent live) and used for new ones; archived and closed boards keep theirs | viewer / admin / admin |
| POST / DELETE | `/api/teams/:teamId/photo` | POST: `multipart/form-data` with one image `file`, stored as a 256px square webp. Both return the team, whose `photoUrl` changes with each new photo | admin |
| GET | `/api/teams/:teamId/photo` | The photo (`image/webp`); 404 when there is none. Works without the team password (it's on the prompt) | viewer |
| POST | `/api/teams/:teamId/unlock` | `password`, or `key` from a link (`#unlock=<teamId>.<key>`). Right: sets `rb_unlock_<team>` (until the password changes). Wrong (or a key from before the password changed): 400; too many tries: 429 | viewer |
| GET | `/api/teams/:teamId/link-key` | `{ key }` for a link that opens the team without typing the password: signed for the current password version, so a new password retires it. `null` with no password | admin |
| PUT | `/api/teams/:teamId/password` | `current?, password` (min 4) or `password: null` to remove. Needs `current`, except from the browser that first set it (`rb_owner_<team>` cookie, which this sets). Every change signs other browsers out. Returns the team | admin |

**Team passwords:** while a team has one, every team and board route answers **423** `{ error, lockedTeam: { id, name } }`
until this browser has unlocked it (or is the one that set it). Teams carry `password: { set, unlocked, owner }`.
Lost both the password and that browser: `./launch.sh unlock <team>` on the server (`npm run unlock -- <team>` without Docker).
| GET | `/api/teams/:teamId/members` | | viewer (emails shown to admins) |
| POST | `/api/teams/:teamId/members` | `email, role` | admin; adds an existing account |
| PATCH | `/api/teams/:teamId/members/:userId` | `role` | admin; last admin can't be demoted |
| DELETE | `/api/teams/:teamId/members/:userId` | | admin, or yourself (leave) |
| GET / POST | `/api/teams/:teamId/invites` | POST: `email?, role, expiresInDays?, maxUses?` | admin |
| DELETE | `/api/invites/:inviteId` | | admin; revokes |
| GET | `/api/invites/by-token/:token` | | public: team name and role |
| POST | `/api/invites/by-token/:token/accept` | | signed in |
| GET / POST | `/api/teams/:teamId/templates` | POST: `name, description?, columns[{title,color,description?}]` | viewer / admin |
| DELETE | `/api/templates/:templateId` | | admin |
| POST | `/api/teams/:teamId/current` | | viewer. The team's current (newest open) board as `{ boardId }`, created from the default template if there is none and you're a member or admin; `null` for viewers |
| GET | `/api/teams/:teamId/boards` | `?status=open\|archived` | viewer |
| POST | `/api/teams/:teamId/boards` | `title, templateId? \| columns?, settings?, carryOver?` | member |
| GET | `/api/teams/:teamId/actions` | `?status=open\|done` | viewer |
| POST | `/api/teams/:teamId/actions` | `title, ownerId?, dueDate? (YYYY-MM-DD), boardId?, cardId?` | member |
| GET | `/api/teams/:teamId/carry-over` | | viewer; `{ cards, openActions }` waiting for the next board |
| GET | `/api/teams/:teamId/search` | `?q=` (2+ chars) | viewer |

## Boards and columns

| Method | Path | Body / query | Needs |
|---|---|---|---|
| GET | `/api/boards/:boardId` | | read. Full state: board, columns, cards (each with `likes` and whether you `liked` it), actions, members and your permissions |
| PATCH | `/api/boards/:boardId` | `title?, status?` (anonymous cards, lock and colors are team settings) | facilitate |
| POST | `/api/boards/:boardId/archive` | `name?, date? (YYYY-MM-DD)` | facilitate. Archives the board into the history as `date · name` (status `archived`) and starts a fresh current board with the same columns; carry-over cards move into same-named columns. Returns `{ saved, board }` and sends `board.next` to everyone on the old board |
| DELETE | `/api/boards/:boardId` | | team admin |
| POST | `/api/boards/:boardId/save-template` | `name, description?` | team admin |
| GET | `/api/boards/:boardId/export` | `?format=md\|csv` | team admin |
| POST | `/api/export` | `boardIds[] (1-500), format: md\|csv` | team admin on every board. One file for many boards, grouped by team (spreadsheet gains `team` and `board` columns). Used by Settings → Export and a team's History |
| POST | `/api/boards/:boardId/columns` | `title, color, description?` | facilitate |
| PATCH | `/api/columns/:columnId` | `title?, color?, description?, position?` | facilitate |
| DELETE | `/api/columns/:columnId` | query `moveTo?` (another column on the board) | facilitate; with `moveTo` its cards move there (after that column's own, groups kept), otherwise they're deleted |

## Cards

| Method | Path | Body | Needs |
|---|---|---|---|
| POST | `/api/boards/:boardId/cards` | `columnId, body, anonymous?, attachmentIds?` | write |
| PATCH | `/api/cards/:cardId` | `body?, anonymous?, attachmentIds?, removeAttachmentIds?` (author or facilitator); `status?, groupTitle?` (anyone who can like) | |
| DELETE | `/api/cards/:cardId` | | write + author or facilitator |
| POST | `/api/cards/:cardId/move` | `columnId, position, alone?` (`alone`: a grouped card leaves on its own, the rest stay grouped) | write. `position` is a fractional key; see `positionBetween()` in shared |
| POST | `/api/cards/:cardId/group` | `targetId` | write |
| POST | `/api/cards/:cardId/arrange` | `order: cardId[]`: the group's cards in order, the first leads it; a card listed from elsewhere leaves there and joins | write |
| POST | `/api/cards/:cardId/ungroup` | | write |
| POST / DELETE | `/api/cards/:cardId/vote` | | vote (like). POST likes the card, DELETE unlikes it; one like per person per card, so repeating either is harmless. Returns `{ ok: true }`; the card arrives as `card.upsert` |
| POST | `/api/reactions` | `targetType: card\|reply, targetId, emoji` | vote. Toggles |
| POST | `/api/cards/:cardId/replies` | `body, parentId?, attachmentIds?` | write |
| PATCH / DELETE | `/api/replies/:replyId` | PATCH: `body` | write + author or facilitator |

`status` is one of `none`, `discussed`, `resolved`, `carry_over`.

## Actions

| Method | Path | Body |
|---|---|---|
| PATCH | `/api/actions/:actionId` | `title?, ownerId?, dueDate?, status?: open\|done` |
| DELETE | `/api/actions/:actionId` | |

## Media

| Method | Path | Notes |
|---|---|---|
| POST | `/api/boards/:boardId/attachments` | `multipart/form-data` with one `file`. Returns an attachment; pass its id in `attachmentIds` |
| POST | `/api/boards/:boardId/attachments/gif` | `url, previewUrl?, width?, height?, title?`. Tenor and Giphy https URLs only |
| GET | `/api/media/:id` and `/api/media/:id/thumb` | Supports `Range` (video seeking) |
| DELETE | `/api/attachments/:id` | Uploader or facilitator |
| GET | `/api/gifs?q=` | Giphy search (`GIPHY_API_KEY`), else Tenor (`TENOR_API_KEY`); trending when `q` is empty; 404 with neither key |

Unused uploads (never attached to a card or reply) stay in storage; they are small and rare.

## Admin

| Method | Path | Body |
|---|---|---|
| GET | `/api/admin/settings` | Instance settings in effect, the launch defaults, which ones were changed, templates, and where data is stored |
| PATCH | `/api/admin/settings` | Any of `siteName, theme (or null), defaultTemplateId, features: { videos: false, … }, allowAnonymous, signup`, plus `reset: [keys]` to go back to launch defaults |
| GET | `/api/admin/backup` | Downloads every table and upload as one `.tar.gz` (`retro-board-backup.json` + `files/<key>`); sessions left out |
| POST | `/api/admin/restore` | multipart `file`: a backup from the route above. Replaces all data (uploads first, then every table in one transaction); returns `{ rows, files }`. Everyone signs in again |
| POST | `/api/admin/templates` | `name, description?, columns[{title,color,description?}]`. A template every team can use; delete with `DELETE /api/templates/:id` |
| GET | `/api/admin/users` | |
| PATCH | `/api/admin/users/:userId` | `role?: admin\|user, disabled?` |

## Health

`GET /api/health` → `{ "ok": true }`. Used by the Docker health check.

## Socket.IO

Connect to `/socket.io` with the session cookie (unauthenticated connections are refused).

| Direction | Event | Payload |
|---|---|---|
| client → server | `board:join` | `boardId`, ack `{ ok, error? }` |
| client → server | `board:leave` | `boardId` |
| client → server | `board:typing` | `boardId, columnId` |
| server → client | `board:typing` | `{ user, columnId }` |
| server → client | `board:event` | one `BoardEvent` (below) |

```ts
type BoardEvent =
  | { type: 'board.update'; board }
  | { type: 'column.upsert'; column } | { type: 'column.delete'; id }
  | { type: 'card.upsert'; card }     | { type: 'card.delete'; id }
  | { type: 'action.upsert'; action } | { type: 'action.delete'; id }
  | { type: 'presence'; users }         // everyone currently on the board
  | { type: 'board.next'; boardId; savedTitle };  // board was archived; move to the fresh one
```
