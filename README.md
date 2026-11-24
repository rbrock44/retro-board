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
  - [No Sign-in Mode](#no-sign-in-mode)
  - [Sign-in Providers](#sign-in-providers)
  - [Configuration](#configuration)
  - [Develop Without Docker](#develop-without-docker)
  - [Test](#test)
  - [Build](#build)
- [Further Docs](#-further-docs)
- [License](#-license)

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

Run on its own, it asks a few questions, each showing the current value (Enter keeps it):

- **Sign-in**: `accounts` (people sign in) or `none` (no sign-in; see [No Sign-in Mode](#no-sign-in-mode))
- who can create an account, admin emails, and which of Google, GitHub, Microsoft and Okta to turn on
- port, the address people open, and an optional GIF search key

Then it saves the answers in `.env` (creating it with a random session secret the first time), builds the image,
starts the app and Postgres, waits until the app is healthy, and opens the browser. **In accounts mode the first
account you create becomes the admin.**

Pass options instead to skip the questions, which suits scripts and servers:

```bash
./launch.sh --auth none --port 3000
./launch.sh --auth accounts --signup invite --google-id … --google-secret …
./launch.sh -y          # no questions, current settings
./launch.sh --help      # every option
```

| Command | Does |
|---|---|
| `./launch.sh` | Ask, then build and start (safe to re-run) |
| `./launch.sh [options]` / `-y` | Build and start without asking |
| `./launch.sh update` | Rebuild after pulling new code |
| `./launch.sh logs` | Follow the app logs |
| `./launch.sh stop` | Stop everything (data is kept in Docker volumes) |

`launch.cmd` takes the same commands and options on Windows. Plain `docker compose up -d --build` works too.

### No Sign-in Mode

`./launch.sh --auth none` (or `AUTH_MODE=none` in `.env`) turns accounts off. Anyone who can open the site can see
every team and board and do everything, including starting and facilitating retros. Each browser gets a guest
identity, and people are asked for their name the first time they add a card or reply.

Use it only on a trusted network, or behind something that already controls who gets in (a VPN, or a proxy with
its own login). Switching back to `accounts` signs guests out; what they wrote stays.

### Sign-in Providers

Email and password works out of the box. **Google, GitHub, Microsoft and Okta** are already wired up: fill in their
values when `./launch.sh` asks (or pass `--google-id`, `--google-secret` and so on, or edit `.env`). Each sign-in
button appears once its values are set.

For Keycloak, Authentik or any other OpenID Connect provider, or to change sign-up rules:

```bash
cp config/auth.example.yaml config/auth.yaml   # then edit
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

---

## 📄 License

[MIT](LICENSE). Free to use, change and share. Provided as is, with no warranty and no liability.
