# Deployment

The Docker setup is production-shaped already: Postgres with a persistent volume, uploads in a volume, health
checks, restarts. This page covers putting it on a real server.

- [On a server](#on-a-server)
- [HTTPS with a reverse proxy](#https-with-a-reverse-proxy)
- [S3 storage for uploads](#s3-storage-for-uploads)
- [Using an existing Postgres](#using-an-existing-postgres)
- [Backups](#backups)
- [Upgrades](#upgrades)
- [Running without Docker](#running-without-docker)
- [Scaling notes](#scaling-notes)

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

When the proxy runs on the same host, you can stop publishing the port publicly by changing `ports` in
`docker-compose.yml` to `"127.0.0.1:${PORT:-8080}:8080"`.

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

Two things hold data: the database and uploaded files.

```bash
# database
docker compose exec -T db pg_dump -U retro -Fc retro > retro-$(date +%F).dump

# uploads (local storage)
docker run --rm -v retro-board_uploads:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads-$(date +%F).tgz -C /data uploads
```

Restore:

```bash
docker compose exec -T db pg_restore -U retro -d retro --clean < retro-2026-01-01.dump
docker run --rm -v retro-board_uploads:/data -v "$PWD":/backup alpine \
  tar xzf /backup/uploads-2026-01-01.tgz -C /data
```

With S3 storage, back up the bucket with your provider's tools instead.

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

## Scaling notes

One app container handles a lot of teams; retros are small and bursty. Live updates are routed in-process, so run
**one** app instance. Running several behind a load balancer would need a Socket.IO adapter (Redis) and sticky
sessions, which isn't set up.
