#!/usr/bin/env sh
# One command to run Retro Board: ./launch.sh
#   ./launch.sh          build and start (creates .env on first run)
#   ./launch.sh stop     stop it
#   ./launch.sh logs     follow the logs
#   ./launch.sh update   rebuild after pulling new code
set -e
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Get it from https://docs.docker.com/get-docker/" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but not running. Start Docker and try again." >&2
  exit 1
fi

case "${1:-up}" in
  stop) docker compose down; exit 0 ;;
  logs) docker compose logs -f app; exit 0 ;;
  update|up) ;;
  *) echo "usage: ./launch.sh [up|stop|logs|update]" >&2; exit 2 ;;
esac

if [ ! -f .env ]; then
  secret=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
  sed "s/^SESSION_SECRET=.*/SESSION_SECRET=$secret/" .env.example > .env
  echo "Created .env with a random SESSION_SECRET"
fi

port=$(grep -E '^PORT=' .env | cut -d= -f2)
url=$(grep -E '^PUBLIC_URL=' .env | cut -d= -f2-)
url=${url:-http://localhost:${port:-8080}}

docker compose up -d --build

printf "Waiting for Retro Board to start"
i=0
until docker compose exec -T app node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 90 ]; then
    echo; echo "It did not come up. Recent logs:" >&2
    docker compose logs --tail 40 app >&2
    exit 1
  fi
  printf "."; sleep 2
done
echo
echo "Retro Board is running at $url"
echo "The first account you create becomes the admin."
( command -v open >/dev/null && open "$url" ) || ( command -v xdg-open >/dev/null && xdg-open "$url" ) >/dev/null 2>&1 || true
