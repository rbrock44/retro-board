# Configuration

Settings are environment variables. With Docker they go in `.env` next to `docker-compose.yml` (the launch scripts
create it from [`.env.example`](../.env.example)). Without Docker, put them in `.env` at the repo root; `npm run dev`
reads it. Restart after changing anything (`./launch.sh update`).

Sign-in providers are defined in `config/auth.yaml` (or the shipped `config/auth.example.yaml`). The example reads
Google, GitHub, Microsoft and Okta credentials from the `GOOGLE_*`, `GITHUB_*`, `MS_*` and `OKTA_*` variables in
`.env`; see [auth.md](auth.md).

## Server

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port to listen on. With Docker, the port on the host |
| `HOST` | `0.0.0.0` | Interface to bind (outside Docker) |
| `ACCESS` | `local` | Read only by the launch scripts: `local`, `network` (sets `PUBLIC_URL` to this computer's network address on every launch) or `domain` (keeps your `PUBLIC_URL`) |
| `PUBLIC_URL` | `http://localhost:<PORT>` | The address people type. Used for OAuth redirect URLs and secure-cookie detection |
| `SESSION_SECRET` | random per start | Signs cookies. **Set it**: without one, everyone is signed out on every restart. Launch scripts generate one |
| `SESSION_DAYS` | `30` | How long a sign-in lasts |
| `COOKIE_SECURE` | `auto` | `auto` marks cookies `Secure` when `PUBLIC_URL` is `https://`. Force with `true` / `false` |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `silent` |

## Database

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | Docker: the bundled Postgres. Otherwise `pglite:./data/pglite` | `postgres://user:pass@host:5432/db` for any Postgres 14+. `pglite:<folder>` for an embedded database in a folder. `memory` for a throwaway one |
| `POSTGRES_PASSWORD` | `retro` | Password for the bundled Postgres container. Only read by `docker-compose.yml` |

Migrations run automatically at startup. There's nothing to run by hand.

**PGlite** is real Postgres compiled to WebAssembly, running inside the app process. It's great for trying things
out, development and small single-instance installs. For anything you depend on, use a Postgres server; the Docker
setup does.

## Your data

Set by the launch scripts from your answer to "Where should your data live?" (`--data folder|volumes`). You
normally don't edit these by hand.

| Variable | Default | Meaning |
|---|---|---|
| `DATA_STORAGE` | `folder` for new installs | `folder` (plain folders in `./data`) or `volumes` (Docker volumes). Switching with `./launch.sh --data …` moves the data |
| `DB_MOUNT` | `db:/var/lib/postgresql/data` | Docker Compose mount for the database, derived from `DATA_STORAGE` |
| `UPLOADS_MOUNT` | `uploads:/data` | Docker Compose mount for uploads, derived from `DATA_STORAGE` |
| `APP_UID`, `APP_GID` | `1000` | On Linux with `folder`, your user id, so the files in `./data/uploads` belong to you |
| `DATA_LOCATION` | | A description of where the data is, shown to admins in Admin → Customize |

## Look and defaults

Starting values for the instance settings. Admins can change each one later in **Admin → Customize**; their change
is saved in the database and wins over these, and **Reset** goes back to these.

| Variable | Default | Meaning |
|---|---|---|
| `SITE_NAME` | `Retro Board` | Shown in the top bar, sign-in page and browser tab |
| `DEFAULT_THEME` | `auto` | `auto` (light or dark, following each device), or `light`, `dark`, `midnight`, `forest`, `sunset`, `grape`, `high-contrast`. Applies to people who haven't picked their own |
| `DEFAULT_ACCENT` | | An accent color like `#ffcd00` on top of the theme |
| `DEFAULT_TEMPLATE` | `went-well` | Columns for new boards: `went-well`, `start-stop-continue`, `mad-sad-glad`, `4ls`, `sailboat`, `blank`. Teams can set their own |
| `DISABLED_FEATURES` | | Features switched off for everyone, comma separated: `images`, `gifs`, `videos`, `anonymous`, `replies`, `reactions`, `likes`, `groups`, `actions`, `carryOver`, `export`, `presence`, `personShades`. Admins can change them in Customize → Features |
| `DEFAULT_ANONYMOUS` | `true` | Whether new boards allow anonymous cards |

There are no vote settings: everyone can like every card, once. Vote settings left in an older `.env` are ignored.

## Accounts

| Variable | Default | Meaning |
|---|---|---|
| `AUTH_MODE` | `accounts` | `accounts`: people sign in to see anything. `none`: no sign-in; anyone who can open the site can do everything and is asked for a name before their first card. Trusted networks only |
| `LOCAL_SIGNUP` | `open` | Who can create an email/password account: `open`, `invite` (team invite link only), `closed`. Read by the default `config/auth.yaml` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | | Turns on Google sign-in. See [auth.md](auth.md#google) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | | Turns on GitHub sign-in |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` | tenant `common` | Turns on Microsoft sign-in. A tenant id limits it to your organisation |
| `OKTA_ISSUER`, `OKTA_CLIENT_ID`, `OKTA_CLIENT_SECRET` | | Turns on Okta sign-in |
| `ADMIN_EMAILS` | | Comma-separated. These become instance admins when they sign up. The first account always does |
| `AUTH_CONFIG` | `config/auth.yaml`, else `config/auth.example.yaml` | Where the sign-in config lives. Docker mounts `./config` at `/app/config` |

## Uploads

| Variable | Default | Meaning |
|---|---|---|
| `MAX_UPLOAD_MB` | `25` | Largest image or video |
| `STORAGE_DRIVER` | `local` | `local` stores files on disk (a Docker volume). `s3` uses any S3-compatible service |
| `UPLOAD_DIR` | `./data/uploads` (Docker: `/data/uploads`) | Folder for `local` |
| `S3_BUCKET` | `retro-board` | Bucket for `s3` |
| `S3_REGION` | `us-east-1` | Region |
| `S3_ENDPOINT` | | For non-AWS services: `https://<account>.r2.cloudflarestorage.com`, `http://minio:9000`, … |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | | Credentials. Leave empty to use the AWS default chain (instance role, env, …) |
| `S3_FORCE_PATH_STYLE` | `true` | Path-style URLs; needed by MinIO, harmless elsewhere |

Accepted uploads: JPEG, PNG, WebP, AVIF, GIF (animation kept), MP4, WebM and MOV. Types are checked from the file's
bytes, never the name or claimed type, so SVG, HTML and other files are refused. Photos are re-encoded to drop
EXIF metadata (location, camera) and rotated upright, and large images get an 800px thumbnail. Files are served
only to people who can see the board, with headers that stop browsers from running them.

## GIF search

| Variable | Default | Meaning |
|---|---|---|
| `TENOR_API_KEY` | | Enables the GIF button. Get a key in Google Cloud console → enable **Tenor API** → Credentials |

Without a key, people can still upload GIF files. Embedded GIFs are only accepted from Tenor and Giphy hosts.

## Web app

| Variable | Default | Meaning |
|---|---|---|
| `WEB_DIST` | auto | Folder with the built Angular app. Found automatically in the image and after `npm run build` |
