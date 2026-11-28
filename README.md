# Retro Board

> A self-hosted, real-time retrospective board for teams. One command to run, any login provider you like

**Try it:** [retro.ryan-brock.com](https://retro.ryan-brock.com) is a live demo that runs entirely in your browser.

---

## 📚 Table of Contents

- [What's My Purpose?](#-whats-my-purpose)
- [How to Use](#-how-to-use)
  - [Teams and Roles](#teams-and-roles)
  - [Running a Retro](#running-a-retro)
  - [Cards, Media and Replies](#cards-media-and-replies)
  - [Likes, Grouping and Marking](#likes-grouping-and-marking)
  - [Carry Over and Action Items](#carry-over-and-action-items)
  - [Demo Mode](#demo-mode)
  - [History, Search and Export](#history-search-and-export)
  - [Themes](#themes)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
- [Technologies](#-technologies)
- [Getting Started (Local Setup)](#-getting-started-local-setup)
  - [Launch (One Command)](#launch-one-command)
  - [Your Data](#your-data)
  - [Customize](#customize)
  - [Share on Your Network](#share-on-your-network)
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

- `Teams` - Everything lives in a team: its retros, history, action items and custom templates. A team admin can
  give it a photo (History → Settings → Team), shown on the team list, the team's pages and its boards; without one
  it shows the team's initials
- `Invite links` - Team admins create links (optionally locked to one email, with an expiry) or add existing
  accounts by email
- `Team roles`
  - `admin` - Manages members, invites, templates and team defaults; closes, archives and deletes boards
  - `member` - Starts retros, adds cards, replies and media, likes cards, reacts, manages action items. Facilitates
    the boards they start
  - `viewer` - Read-only, for stakeholders who want to follow along
- `Team password` - A team admin can put a password on a team (History → Settings → Password). Everyone then types
  it once per browser to open the team's boards, and again after it changes. The browser that set it never has to,
  and can set a new one without the old one, so a forgotten password isn't a dead end. Other admins need the old
  one to change it. If both are lost, whoever runs the server removes it with `./launch.sh unlock "<team>"`
- `Instance Admin` - The first account created, plus anyone in `ADMIN_EMAILS`. Manages every account from the
  `Admin` page and acts as admin on every team

### Running a Retro

Each team has one **current board**. Clicking a team opens it straight away (a team with no board gets one from
its default template), so people always land in the right place.

- `🗄 Archive Board` - When the retro is done, a facilitator archives it. The board moves to the team's history as
  it is, titled with the date and an optional name (`2026-11-24 · Sprint 42`), and a fresh `Current` board takes
  its place with the same columns and settings. Cards marked `Carry Over` move to the fresh board, back in the
  column they came from. Everyone on the board is moved over automatically
- `New Board` (on the History page) - Pick a template (Went Well / To Improve / Actions, Start / Stop / Continue, Mad / Sad / Glad,
  4Ls, Sailboat, Blank, or one your team saved) and whether anonymous cards are allowed
- `Columns` - Facilitators add, rename, recolor (color picker with presets), describe, reorder and delete columns.
  `Save Columns as Template` keeps a layout for the team
- `Team Settings` - Set once per team (History → Settings → Boards) and applied to all its boards: the columns new
  boards start with, anonymous cards, `Lock` (no new or edited cards; likes and reactions stay open) and the team's
  colors. Changes reach the current board live and carry on to the next ones; boards in History keep exactly what
  they had
- `Board Settings` - What's about one board: `Archive Board`, `Delete` and `Save Columns as Template`
- `Live` - Every change appears for everyone instantly. Avatars in the header show who is on the board, and a
  "typing…" hint shows under columns where someone is writing

### Cards, Media and Replies

- `Cards` - Markdown text (bold, lists, links, code). Tick `Anonymous` to hide your name from everyone, for good: an
  anonymous card can't be switched back
- `Add-card box` - Pick how it sits at the top of each column (Settings → Board): `Compact` (default), a one-line
  `＋ Add a card` that opens into the full box; `Header button`, just ＋ beside the column name; or `Full`, always open.
  `N` opens it in the column in view, `Esc` or `Cancel` folds it away
- `Media` - Attach images, GIFs and videos (mp4, webm, mov) with 📎, by pasting an image, or by dropping files on
  the composer. With a Giphy or Tenor key configured, the `GIF` button searches GIFs.
  Text and any mix of images, GIFs and videos go together in one card or reply. Click an image for a bigger view:
  the mouse wheel zooms in and out, a click zooms in (and back to fit once fully zoomed), drag to move around, and the
  scale at the top right shows how far it's zoomed. It never fills the screen, so a click around it always closes it
- `Replies` - 💬 opens a thread on any card. Replies support markdown, media and reactions, and can be answered
  one level deep. The two arrow buttons after `Sort` open or close every thread on the board
- `Reactions` - Emoji reactions on cards and replies, separate from likes. `☺+` offers a quick row; 🔍 opens every
  emoji with search, categories, skin tones and your most used
- `People` - Click someone's face or name on a card or reply for their details: email (shown to team admins), team
  role, when they joined, their named cards and likes on this board, and whether they're here now
- `🎨 Color by Person` - Each person's cards get their own light shade (the same on every board), so you can see
  who wrote what at a glance. Their avatar on the board gets a matching ring. Anonymous cards stay neutral, so the
  shade never gives them away. An admin turns it on or off for everyone in **Admin → Customize → Features**

### Likes, Grouping and Marking

- `Like` - 👍 on a card likes it, click again to unlike. Everyone can like every card, once. No budget, no limits
- `Arrange` - Cards are locked in place until you click `✥` in any column header (or press `A`) for Arrange Mode:
  a strip explains it, cards show a grab cursor, and where you'd drop lights up as you drag. Drop on a card's top or
  bottom edge to place it there (across columns too), on its middle to group with it, or on an empty part of a
  column to move it to the end. `Done` (or `Esc`) locks them again
- `Group` - In Arrange Mode, drag a card onto the middle of another card or group. Or use a card's `⋯` →
  `Create Group` (or `Add to Group` on a grouped card) and click the target. A group shows as a box with its name, then every card in it at full size; click the name to rename it. The box shows how many cards are in it and their combined likes.
  In Arrange Mode, drag the group's header to move the whole group; drag a card inside it to reorder the group, move
  it to another group, or pull it out on its own (the first card leads the group and keeps its name)
- `Focus` - `⤢` in a column header shows that column in a big popup over the dimmed board, its cards in a roomy
  grid, to go over it together. `‹` `›` or the arrow keys step to the next column, and past the last one to the
  action items (also one click away on the checklist button beside them); `Esc` or a click outside closes. Reply
  threads start open (turn that off in Settings → Full-Screen Column), with the reply box tucked behind `↩ Reply`.
  Elsewhere the box shows as soon as a thread opens; turn that off in Settings → Board to tuck it away there too.
  Who's on the board shows at the top left. On its left, one button opens every reply thread in the column (or closes them all once they're all open), and the
  person button picks a random teammate to go over the column. They get `Yes, I'll Go` or `Not Right Now`: not right
  now asks someone else and keeps them on the list for later, but nobody who just passed is asked again until someone
  says yes. Everyone gets a turn, in random order, before anyone goes twice (remembered per team in your browser)
- `Who presents next` - The person button after `Sort` picks someone the same way, without the full-screen view;
  whoever says yes shows beside it until cleared with ✕
- `Sort` - The board's own order comes first. It reads `Oldest First` until someone rearranges cards in Arrange Mode
  (including across columns), then `Custom`. `Oldest First`, `Newest First` and `Most Liked` show other views without
  changing it. Turning Arrange Mode on goes back to the board's own order
- `Mark` - `⋯` → `Mark as` `Discussed`, `Resolved` or `Carry Over`; pick the checked one again to unmark. Filter the board by mark with `Show`

### Carry Over and Action Items

- `Carry Over` - Cards marked `Carry Over` move to the next board (saved or started from `New Board`), into the
  column with the same name, linked back to where they came from and marked with a purple `Carried Over` band. If the
  new board has no such column they go in a `Carried Over` column instead. Each card is carried once
- `Action Items` - Create them from a card (`⋯` → `Create Action Item`), from the board's `Action Items` panel, or on
  the team page. Each has an owner and due date. Open items from every retro show on every new board until done

### Demo Mode

If the app can't reach its server when it starts, it runs as a **demo** instead: sample teams, a finished retro
and a live one with likes, groups, replies and images, plus pretend teammates who like and add cards while you
watch. A banner says it's a demo. This is what [retro.ryan-brock.com](https://retro.ryan-brock.com) is: the web app
on GitHub Pages with no server behind it.

- **🧭 Tour** walks through every feature one at a time, highlighting each on the real page: teams, the current
  board, cards and media, likes, groups, marking and carry over, replies, live teammates, action items, saving to
  history, board settings, Customize and sharing. First-time visitors are offered it once
- **Everything works and is saved in your browser**: add teams, start retros, write cards, like, mark, carry over
- **Demos** keeps several setups side by side; open, rename, delete, or start a new one from the sample data.
  **Reset** puts the current one back
- **Share** copies a link that carries the whole demo. Whoever opens it gets their own copy to play with. Big
  uploads (over about 200 KB) are left out to keep links short
- **Switch person** lets you be anyone on the sample teams
- Add `?demo` to the address of a real install to see the demo there without touching real data
- **[`?demo=lock`](https://retro.ryan-brock.com/?demo=lock)** shows team passwords: a separate "Password demo"
  where one team was locked in "another browser" (the password, `retro`, is on the banner and the prompt). Set
  your own on the other team to see the original-browser side

Demo mode only starts when the server doesn't answer at load time. If a running server drops later, you see
errors and live updates reconnect as usual, rather than quietly swapping in sample data.

### History, Search and Export

- `History` - The link next to the team name on a board. `Past Boards` lists every board the team has saved,
  filterable by current and archived; open any of them to read it. Saved boards are read-only, with a button
  back to the current board
- `Search` - Searches every card, group name and action item the team has ever written
- `Export` - For team admins (and instance admins). The `Current` board has no Export button of its own; export it, and any past boards, from the Export popup:
  - **Settings → Export → `Export Retros…`** opens a popup with every team you're on, each with its Current board and past boards.
    Tick whole teams or single boards, pick Markdown (a readable summary) or a spreadsheet (one row per card), and
    get one file, grouped by team
  - A team's **History** has an `Export` button for that team's boards, and each past board has its own `Export`
  - A past board, opened from History, also has `Export` with `Print / PDF` for a clean printout

### Themes

- `Profile & Theme` - Pick a preset (Light, Dark, Midnight, Forest, Sunset, Grape, High contrast), then fine-tune
  any of the nine colors with a color picker. Contrast warnings tell you when text gets hard to read. Your theme
  follows you to any device
- `☀ / ☾` - Quick switch between light and dark in the top bar
- `Team colors` - A team admin can give all of a team's boards their own colors that everyone sees (team Settings)

### Keyboard Shortcuts

| Key | Where | Does |
|---|---|---|
| `Enter` (or `Ctrl/⌘ + Enter`) | Any composer | Submit the card, reply or edit. On phones and tablets Enter adds a line; use the button |
| `Shift + Enter` | Any composer | New line |
| `Esc` | Composer, menus, group picking, Arrange Mode, column popup | Cancel or close |
| `A` | Board | Toggle Arrange Mode (also `✥` in a column header) |

---

## 🛠 Technologies

- `Angular 22` - Standalone components, signals, zoneless change detection, Angular CDK drag and drop
- `emoji-picker-element` - The full emoji picker; its emoji list is served by the app itself
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

Works on **Windows, macOS and Linux** (Intel or ARM: Apple Silicon Macs, and Raspberry Pi 4/5 with the 64-bit OS). The only thing
to install is Docker.

**1. Install Docker** (skip if you have it)

| Your computer | Get |
|---|---|
| Windows 10/11 | [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) |
| Mac | [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) |
| Linux | [Docker Engine](https://docs.docker.com/engine/install/), or `curl -fsSL https://get.docker.com \| sh` |

**2. Get Retro Board.** Either `git clone https://github.com/rbrock44/retro-board.git`, or download the ZIP from
GitHub (`Code` → `Download ZIP`) and unzip it. No git needed.

**3. Run it** from the `retro-board` folder:

| Windows | macOS / Linux |
|---|---|
| Double-click `launch.cmd`, or run `launch.cmd` in a terminal | `./launch.sh` |

It asks a few questions, each with a sensible default already filled in (press Enter to keep it):

1. **Where your data lives**: a plain `data` folder next to the app, or Docker-managed volumes. It stays on your
   computer either way ([Your Data](#your-data))
2. **Who will open it**: just you, people on your network, or a real web address
3. **How people get in**: accounts, or no sign-in at all ([No Sign-in Mode](#no-sign-in-mode)), plus
   Google / GitHub / Microsoft / Okta if you want them
4. **Look and defaults** (optional): site name, theme and accent color, default columns
5. **GIF search** (optional)

Then it builds, starts, waits until everything is healthy, and opens your browser. **In accounts mode, the first
account you create becomes the admin.** The first start takes a minute or two; later ones are quick.

The launcher looks after the usual snags: it starts Docker Desktop if it's installed but not running, tells you
exactly what to install if Docker or Docker Compose is missing or too old, and offers another port if 8080 is taken.

Pass options instead of answering questions, which suits scripts and servers:

```bash
./launch.sh --data folder --network --auth none        # office network, no sign-in
./launch.sh --site-name "Team Retros" --theme forest --accent "#ffcd00" --columns 4ls
./launch.sh --auth accounts --signup invite --google-id … --google-secret …
./launch.sh -y          # no questions, current settings
./launch.sh --help      # every option
```

| Command | Does |
|---|---|
| `./launch.sh` | Ask, then build and start (safe to re-run; your answers become the defaults) |
| `./launch.sh [options]` / `-y` | Build and start without asking |
| `./launch.sh update` | Rebuild after pulling or downloading new code |
| `./launch.sh backup` | Save everything to one file in `backups/` |
| `./launch.sh backup --encrypt` | The same, locked with a passphrase (for copies kept elsewhere) |
| `./launch.sh restore <file>` | Put a backup back |
| `./launch.sh unlock ["<team>"]` | Remove a forgotten team password (no team: list the ones that have one) |
| `./launch.sh logs` | Follow the app logs |
| `./launch.sh stop` | Stop it (your data stays) |

`launch.cmd` takes the same commands and options on Windows (it runs `launch.ps1`). Plain
`docker compose up -d --build` works too.

### Your Data

**Everything stays on the computer running Retro Board.** There's no cloud service, no account with us, and no
tracking. The only things that ever leave the machine are ones you turn on: GIF searches (sent to Giphy or Tenor, if
you add a key) and sign-ins through a provider you set up (Google, Microsoft, …).

Where it lives is your choice at setup:

| Choice | Where | Good for |
|---|---|---|
| `folder` (the default) | `data/postgres` (database) and `data/uploads` (images, GIFs, videos) next to the app | Seeing your data, copying it, backing it up with whatever you already use |
| `volumes` | Docker volumes `retro-board_db` and `retro-board_uploads` | Keeping it out of sight; slightly faster on Mac and Windows |

Switch any time with `./launch.sh --data folder` (or `volumes`): the launcher saves a backup, moves the data
across, and leaves the old copy where it was. Admins also see where the data is in **Admin → Customize**.

**Backups** are one file with the database and every upload:

```bash
./launch.sh backup                                        # → backups/retro-board-2026-11-24_103000.tar.gz
./launch.sh restore backups/retro-board-2026-11-24_103000.tar.gz
```

A backup restores on any computer, in either storage mode, and into newer versions of Retro Board.
`./launch.sh backup --encrypt` locks the file with a passphrase (`.tar.gz.enc`); `restore` asks for it again.

No command line? Admins can `Download Backup` and `Restore from Backup` in `Admin` → `Customize` → `Your Data`.
It works on any host (embedded database, Postgres, S3), which makes moving from your computer to a server one upload.
The two kinds of backup go back the way they came: app backups in the app, `launch.sh` backups with `launch.sh restore`.

### Customize

Almost everything can be changed, at three levels:

| Who | Where | What |
|---|---|---|
| The person setting it up | `./launch.sh` questions or options | Site name, theme, accent color, default columns, sign-in, providers |
| Instance admins | **Admin → Customize** | The same look and defaults, plus templates every team can use, who can sign up, and **Features**: switch off image, GIF or video uploads, anonymous cards, replies, reactions, likes, groups, action items, carry over, export, who's here, or Color by Person for everyone (each has an ⓘ explaining it). Off means hidden in the app and refused by the server, and media of a switched-off kind isn't served. Starts from the launch settings (`--disable videos,gifs`); **Reset** goes back to them |
| Team admins | Team **History → Settings** | For all the team's boards: default columns, anonymous cards, lock, and the team's colors; plus saved column templates |
| Facilitators | On a board | Columns (add, rename, recolor, reorder), and **⚙ Board Settings**: close, archive, delete, save columns as a template |
| Everyone | **Profile & theme** | Their own theme: 7 presets or any colors, with a readability check |

### Share on Your Network

To let coworkers use it from their own computers, run it on one machine with network access on:

```bash
./launch.sh --network          # or answer "network" when it asks who will open it
```

When it's up, it prints the address to send people, such as `http://192.168.1.20:8080`. That address uses this
computer's network IP, which it looks up again on every launch, so if the IP changes, run it again and send the new
one. On Windows, `launch.cmd` offers to open the port in Windows Firewall (it asks for admin).

- Everyone has to be on the same network (office LAN or VPN), and this computer has to stay on with Docker running.
  Docker restarts the app by itself after a reboot once Docker Desktop starts
- It's plain `http`, so on a network you don't trust, sign-in details travel unencrypted. Pair it with
  `--auth none` on a trusted network, or put it behind HTTPS ([docs/deployment.md](docs/deployment.md))
- Google, Microsoft and Okta won't sign people in at a bare IP address; use email and password, GitHub, or no
  sign-in

### No Sign-in Mode

`./launch.sh --auth none` (or `AUTH_MODE=none` in `.env`) turns accounts off. Anyone who can open the site can see
every team and board and do everything, including starting and facilitating retros. Each browser gets a guest
identity, and people are asked for their name the first time they add a card or reply.

People don't have to stay tied to one browser. When someone new opens a team, they're asked **"Who are you?"** with
the team's people listed ("Are you one of these?") plus anyone who has used this browser before. Picking a name
carries on as that person; otherwise they type a new one. **Switch person** in the menu does the same at any time,
for a shared meeting-room laptop.

A team password keeps a team's boards from people who don't have it, but with no sign-in, everyone is also an
instance admin, so anyone can download a full backup from `Admin`. Use it only on a trusted network, or behind
something that already controls who gets in (a VPN, or a proxy with
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
| `GIPHY_API_KEY` | | Turns on GIF search through Giphy (used over Tenor if both are set) |
| `TENOR_API_KEY` | | Turns on GIF search through Tenor |

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
