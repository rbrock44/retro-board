# Deployment

The Docker setup is production-shaped already: Postgres with a persistent volume, uploads in a volume, health
checks, restarts. This page covers putting it on a real server.

- [On your office network](#on-your-office-network)
- [On a server](#on-a-server)
- [HTTPS with a reverse proxy](#https-with-a-reverse-proxy)
- [S3 storage for uploads](#s3-storage-for-uploads)
- [Using an existing Postgres](#using-an-existing-postgres)
- [Backups](#backups)
- [Upgrades](#upgrades)
- [Running without Docker](#running-without-docker)
- [Scaling notes](#scaling-notes)

## On your office network

The simplest setup: one computer runs Docker and everyone else opens it in a browser.

```bash
./launch.sh --network
```

The launcher finds the computer's network IP, sets `PUBLIC_URL=http://<ip>:<port>` (again on every launch, in case
the IP changed), and prints the address to share. On Windows it offers to add an inbound firewall rule for the
port (`Retro Board (8080)`, Private and Domain networks), and Windows needs the network set to Private for it to
apply. On Linux, open the port yourself (`sudo ufw allow 8080/tcp`).

For an address that doesn't change, give the computer a reserved IP in your router, or a DNS name, and use
`./launch.sh --url http://retro.office.lan:8080` instead.

## On a server

```bash
git clone <this repo> retro-board && cd retro-board
./launch.sh --url https://retro.example.com    # or run it bare and answer the questions
```

Then put a reverse proxy in front for HTTPS.

## HTTPS with a reverse proxy

The proxy must pass WebSocket upgrades on `/socket.io` and forward the client's address. Set
`PUBLIC_URL=https://…`; cookies then become `Secure` automatically.

**Caddy** (gets certificates by itself):

```caddy
retro.example.com {
  reverse_proxy localhost:8080
}
```

**nginx**:

```nginx
server {
  listen 443 ssl;
  server_name retro.example.com;
  # ssl_certificate / ssl_certificate_key …

  client_max_body_size 30m;   # a little above MAX_UPLOAD_MB

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 1h;
  }
}
```

**Traefik**: add labels to the `app` service in `docker-compose.yml`; WebSockets work without extra config.

When the proxy or tunnel runs on the same host, keep the port to that host with `./launch.sh --bind local`
(Docker otherwise publishes it on every network the server is on, past its firewall).

The app believes the client address a proxy reports only when the proxy connects from this machine or a
private network (`TRUST_PROXY`, see [configuration](configuration.md)), so visitors can't fake it to get around
the limits on password guesses. A proxy on a public address needs `TRUST_PROXY` set to it.

## S3 storage for uploads

Uploads default to the `uploads` Docker volume. To use object storage instead, set in `.env`:

```env
STORAGE_DRIVER=s3
S3_BUCKET=retro-board
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com   # omit for AWS
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
```

To try it locally with the bundled MinIO:

```bash
docker compose --profile s3 up -d
# open http://localhost:9001, sign in with S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY, create bucket "retro-board"
# .env: STORAGE_DRIVER=s3, S3_ENDPOINT=http://minio:9000
./launch.sh update
```

Files already uploaded to the volume are not moved automatically; copy `/data/uploads` into the bucket keeping the
same paths if you switch on an existing install.

## Using an existing Postgres

Point the app at it in `.env` and remove the `db` service and `depends_on` from `docker-compose.yml`:

```env
DATABASE_URL=postgres://retro:secret@db.internal:5432/retro
```

Then, since `docker-compose.yml` sets `DATABASE_URL` itself, delete that line from its `environment:` block too.
Postgres 14 or newer. The app creates its tables on first start.

## Backups

```bash
./launch.sh backup                       # one file in backups/: database + every upload
./launch.sh restore backups/<file>.tar.gz
```

A backup restores into either storage mode and into newer versions (the database is replaced, then upgraded as
usual on start). Run `backup` from cron or Task Scheduler for regular copies, and keep some of them on another
machine.

**Encrypted:** `./launch.sh backup --encrypt` asks for a passphrase and saves `backups/<file>.tar.gz.enc`
(AES-256-GCM, key from scrypt), which is useless without it. That's the one to copy to another drive or cloud
storage. `./launch.sh restore <file>.enc` notices and asks for the passphrase; a wrong one changes nothing.
For cron, set `BACKUP_PASSPHRASE` in the job's environment rather than in `.env`, and keep the passphrase
somewhere other than the server: if the server dies with it, the backups can't be opened.

```bash
# crontab: every night at 3, encrypted, then copied off the box
0 3 * * * cd /srv/retro-board && BACKUP_PASSPHRASE="$(cat ~/.retro-backup-pass)" ./launch.sh backup --encrypt && rclone copy backups r2:retro-backups
```

### In the app

Admins can also back up and restore from **Admin → Customize → Your Data**, with no command line: `Download Backup`
saves every table and every upload (S3 included) in one `.tar.gz`, and `Restore from Backup` loads one into this or
any other Retro Board, on any host or database. That's the easy way to move from your own computer to a server.

- Restoring **replaces everything**. Sign-in sessions aren't in backups, so everyone signs in again afterwards
- A backup from a newer version is refused; older ones go into newer versions
- The file holds everyone's data, including password hashes: keep it private
- The two kinds don't mix: an app backup goes back in the app, a `./launch.sh backup` with `./launch.sh restore`
- Behind Cloudflare (Tunnel or proxy), uploads are capped at 100 MB per request on the free plan, which limits restore size

With `--data folder`, the live data is also plain files in `data/`, so a normal file backup works too **while the
app is stopped** (`./launch.sh stop`); copying a running database's files can catch it mid-write. With S3 storage,
back up the bucket with your provider's tools; `backup` only covers the database then.

By hand, without the launcher:

```bash
docker compose exec -T db pg_dump -U retro -Fc retro > retro.dump
docker compose exec -T app tar czf - -C /data uploads > uploads.tgz
```

## Upgrades

```bash
git pull
./launch.sh update
```

Database migrations run at startup. Take a backup first when upgrading across many versions.

## Running without Docker

Node 24 and a Postgres server:

```bash
npm ci
npm run build
DATABASE_URL=postgres://… SESSION_SECRET=… PUBLIC_URL=https://… npm start
```

Run it under systemd, pm2 or similar. `npm start` serves the web app and API on `PORT` (8080).

## The public demo

`.github/workflows/test.yml` has a `demo` job: on every push to `master`, after the tests pass, it builds the web
app and publishes it to the `gh-pages` branch with a `CNAME` of `retro.ryan-brock.com` (and a `404.html` copy of
`index.html` so deep links load). With no API there, the app runs in [demo mode](../README.md#demo-mode).

To point it somewhere else, change `cname:` in that job. For the domain to work, add a DNS `CNAME` record for it to
`<github-user>.github.io` and turn on Pages for the `gh-pages` branch in the repo settings.

## Scaling notes

One app container handles a lot of teams; retros are small and bursty. Live updates are routed in-process, so run
**one** app instance. Running several behind a load balancer would need a Socket.IO adapter (Redis) and sticky
sessions, which isn't set up.
