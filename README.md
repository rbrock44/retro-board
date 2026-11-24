# Retro Board

> A self-hosted, real-time retrospective board for teams. One command to run, any login provider you like

---

## 📚 Table of Contents

- [What's My Purpose?](#-whats-my-purpose)
- [How to Use](#-how-to-use)
  - [Teams and Roles](#teams-and-roles)
  - [Running a Retro](#running-a-retro)
  - [Cards, Media and Replies](#cards-media-and-replies)
  - [Voting, Grouping and Marking](#voting-grouping-and-marking)
  - [Carry Over and Action Items](#carry-over-and-action-items)
  - [History, Search and Export](#history-search-and-export)
  - [Themes](#themes)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
- [Technologies](#-technologies)
- [Getting Started (Local Setup)](#-getting-started-local-setup)
  - [Launch (One Command)](#launch-one-command)
  - [Sign-in Providers](#sign-in-providers)
  - [Configuration](#configuration)
  - [Develop Without Docker](#develop-without-docker)
  - [Test](#test)
  - [Build](#build)
- [Further Docs](#-further-docs)

---

## 🧠 What's My Purpose?

To give teams a retro board they own: it runs on your machine or server, keeps every past retro searchable, and
plugs into whatever sign-in your company already uses (Google, Microsoft, Okta, Keycloak, Authentik, GitHub, or
plain email and password).

---

## 🚦 How to Use

### Teams and Roles

- `Teams` - Everything lives in a team: its retros, history, action items and custom templates
- `Invite links` - Team admins create links (optionally locked to one email, with an expiry) or add existing
  accounts by email
- `Team roles`
  - `admin` - Manages members, invites, templates and team defaults; closes, archives and deletes boards
  - `member` - Starts retros, adds cards, replies and media, votes, reacts, manages action items. Facilitates
    the boards they start
  - `viewer` - Read-only, for stakeholders who want to follow along
- `Instance admin` - The first account created, plus anyone in `ADMIN_EMAILS`. Manages every account from the
  `Admin` page and acts as admin on every team

### Running a Retro

- `New retro` - Pick a template (Went Well / To Improve / Actions, Start / Stop / Continue, Mad / Sad / Glad,
  4Ls, Sailboat, Blank, or one your team saved), a vote budget and whether anonymous cards are allowed
- `Columns` - Facilitators add, rename, recolor (color picker with presets), describe, reorder and delete columns.
  `Save columns as template` keeps a layout for the team
- `Board settings` - Votes per person, max votes per card, anonymous cards, `Lock` (no new or edited cards, voting
  stays open), a board-wide color theme, and `Close` / `Reopen` / `Archive`
- `Live` - Every change appears for everyone instantly. Avatars in the header show who is on the board, and a
  "typing…" hint shows under columns where someone is writing

### Cards, Media and Replies

- `Cards` - Markdown text (bold, lists, links, code). Tick `Anonymous` to hide your name from everyone
- `Media` - Attach images, GIFs and videos (mp4, webm, mov) with 📎, by pasting an image, or by dropping files on
  the composer. With a Tenor key configured, the `GIF` button searches GIFs. Click an image for a full-size view
- `Replies` - 💬 opens a thread on any card. Replies support markdown, media and reactions, and can be answered
  one level deep
- `Reactions` - Emoji reactions on cards and replies, separate from votes

### Voting, Grouping and Marking

- `Vote` - `+` spends one of your votes, `−` takes one back. The header shows how many you have left
- `Group` - Turn on `Group mode` (or press `G`) and drag a card onto another card, or use a card's `⋯` →
  `Group with…` and click the target. Name the group by clicking its title. Groups show their combined votes
- `Sort` - `Manual` (drag to reorder, including across columns) or `Most votes`
- `Mark` - `⋯` → `Mark as` `Discussed`, `Resolved` or `Carry over`. Filter the board by mark with `Show`

### Carry Over and Action Items

- `Carry over` - Cards marked `Carry over` move into the team's next retro, in a `Carried over` column that links
  back to where they came from. Each card is carried once
- `Action items` - Create them from a card (`⋯` → `Create action item`), from the board's `Actions` panel, or on
  the team page. Each has an owner and due date. Open items from every retro show on every new board until done

### History, Search and Export

- `Retros tab` - Every board the team has run, filterable by open, closed and archived
- `Search` - Searches every card, group name and action item the team has ever written
- `Export` - Markdown, CSV, or `Print / PDF` for a clean printed summary

### Themes

- `Profile & theme` - Pick a preset (Light, Dark, Midnight, Forest, Sunset, Grape, High contrast), then fine-tune
  any of the nine colors with a color picker. Contrast warnings tell you when text gets hard to read. Your theme
  follows you to any device
- `☀ / ☾` - Quick switch between light and dark in the top bar
- `Board theme` - Facilitators can give a single board its own colors that everyone sees

### Keyboard Shortcuts

| Key | Where | Does |
|---|---|---|
| `Ctrl/⌘ + Enter` | Any composer | Submit the card or reply |
| `Esc` | Composer, menus, group picking | Cancel |
| `G` | Board | Toggle group mode |

---

## 🛠 Technologies

- `Angular 22` - Standalone components, signals, zoneless change detection, Angular CDK drag and drop
- `Node 24 + Fastify 5` - The API, which also serves the built web app
- `Socket.IO` - Live board updates and presence
- `PostgreSQL 17 + Drizzle ORM` - Data and SQL migrations, applied on startup.
  [PGlite](https://pglite.dev) (Postgres compiled to WebAssembly) runs local development and the tests with no
  database server
- `openid-client` - Any OpenID Connect provider; GitHub has its own OAuth driver
- `sharp` - Image checks, EXIF stripping and thumbnails
- `Docker Compose` - One image for the app, plus Postgres (and optional MinIO for S3 storage)
- `Vitest` - Tests for the shared rules, the API (against a real in-memory Postgres) and the web app

---

## 🏁 Getting Started (Local Setup)

### Launch (One Command)

Needs only [Docker](https://docs.docker.com/get-docker/).

```bash
git clone <this repo> retro-board
cd retro-board
./launch.sh          # macOS / Linux
launch.cmd           # Windows
```

It creates `.env` with a random session secret, builds the image, starts the app and Postgres, waits until the
app is healthy, and opens http://localhost:8080. **The first account you create becomes the admin.**

| Command | Does |
|---|---|
| `./launch.sh` | Build and start (safe to re-run) |
| `./launch.sh update` | Rebuild after pulling new code |
| `./launch.sh logs` | Follow the app logs |
| `./launch.sh stop` | Stop everything (data is kept in Docker volumes) |

Plain `docker compose up -d --build` works too.

### Sign-in Providers

Email and password works out of the box. To add Google, Microsoft, Okta, Keycloak, Authentik, GitHub or any other
OpenID Connect provider:

```bash
cp config/auth.example.yaml config/auth.yaml   # uncomment and fill in the providers you want
./launch.sh update
```

Register `<PUBLIC_URL>/api/auth/<id>/callback` as the redirect URL with each provider. Step-by-step setup for each
one is in [docs/auth.md](docs/auth.md).

### Configuration

All settings live in `.env`; [`.env.example`](.env.example) lists every option with comments. The ones you are most
likely to change:

| Setting | Default | Purpose |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:8080` | The address people use. Required for external sign-in |
| `PORT` | `8080` | Port on the host |
| `ADMIN_EMAILS` | | Extra instance admins |
| `MAX_UPLOAD_MB` | `25` | Largest image or video |
| `STORAGE_DRIVER` | `local` | `s3` for S3, R2, MinIO or B2 |
| `TENOR_API_KEY` | | Turns on GIF search |

Full reference: [docs/configuration.md](docs/configuration.md). HTTPS, reverse proxies, backups and upgrades:
[docs/deployment.md](docs/deployment.md).

### Develop Without Docker

Needs Node 24 (`nvm use`).

```bash
npm install
npm run dev
```

Opens the API on http://localhost:8080 and the web app with live reload on http://localhost:4200 (use this one).
The database is embedded PGlite stored in `apps/api/data/`, so nothing else needs installing. Delete that folder
to start fresh. See [docs/development.md](docs/development.md).

### Test

```bash
npm test
```

Runs the shared rules, API and web tests. The API tests run against an in-memory Postgres (PGlite), including
uploads and live Socket.IO updates.

### Build

```bash
npm run build     # web to apps/web/dist/browser, API to apps/api/dist
npm start         # serve both on :8080
```

---

## 📖 Further Docs

| Doc | Covers |
|---|---|
| [docs/auth.md](docs/auth.md) | Setting up each sign-in provider, account linking, sign-up policy |
| [docs/configuration.md](docs/configuration.md) | Every environment variable |
| [docs/deployment.md](docs/deployment.md) | HTTPS, reverse proxy, S3 storage, backups, upgrades |
| [docs/architecture.md](docs/architecture.md) | How the pieces fit, data model, realtime, permissions |
| [docs/api.md](docs/api.md) | REST endpoints and Socket.IO events |
| [docs/development.md](docs/development.md) | Repo layout, migrations, adding a provider, conventions |
