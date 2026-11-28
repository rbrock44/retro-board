#!/bin/sh
# Tests launch.sh against a fake docker in a throwaway copy, checking what it writes to .env.
# Plain POSIX sh on purpose: CI runs it with dash (Debian/Ubuntu's sh) and BusyBox (Alpine).
#   sh scripts/test-launch.sh
set -u
SRC=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
fail=0
check() { if grep -qE "^$1=$2\$" .env; then echo "  ok   $1=$2"; else echo "  FAIL $1 (got: $(grep -E "^$1=" .env | tail -1))"; fail=1; fi; }

mkdir -p "$WORK/bin"
cat > "$WORK/bin/docker" <<'EOF'
#!/bin/sh
case "$*" in
  info*) exit 0 ;;
  "compose version --short") echo 2.29.1 ;;
  "compose version") echo "Docker Compose version v2.29.1" ;;
  compose\ ps*) exit 0 ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$WORK/bin/docker"
export PATH="$WORK/bin:$PATH"

fresh() { rm -rf "$WORK/w"; mkdir -p "$WORK/w"; cp "$SRC/launch.sh" "$SRC/.env.example" "$WORK/w/"; cd "$WORK/w"; }

echo "== $( (grep ^PRETTY_NAME /etc/os-release 2>/dev/null || uname -s) | cut -d= -f2) ($(readlink -f /bin/sh 2>/dev/null || echo sh))"

echo "-- options, no questions"
fresh
sh launch.sh --data folder --access local --port 9000 --auth none --site-name "Hawkeye Retros" --theme forest --accent '#ffcd00' --columns 4ls --disable 'videos, gifs' </dev/null >out.txt 2>&1 || { echo "  FAIL exit $?"; cat out.txt; fail=1; }
check DATA_STORAGE folder
check DB_MOUNT './data/postgres:/var/lib/postgresql/data'
check UPLOADS_MOUNT './data/uploads:/data/uploads'
check PUBLIC_URL 'http://localhost:9000'
check AUTH_MODE none
check SITE_NAME 'Hawkeye Retros'
check DEFAULT_THEME forest
check DEFAULT_ACCENT '#ffcd00'
check DEFAULT_TEMPLATE 4ls
check DISABLED_FEATURES 'videos,gifs'
[ -d data/postgres ] && [ -d data/uploads ] && echo "  ok   ./data folders made" || { echo "  FAIL ./data folders"; fail=1; }
grep -q "Your data stays on this computer, in $WORK/w/data" out.txt && echo "  ok   says where data lives" || { echo "  FAIL data message"; fail=1; }
if [ "$(id -u)" != 0 ]; then check APP_UID "$(id -u)"; fi
check PUBLISH_ON '127.0.0.1:'

echo "-- who can reach the port"
sh launch.sh --url https://retro.example.com -y </dev/null >out.txt 2>&1
check PUBLISH_ON ''
sh launch.sh --bind local -y </dev/null >out.txt 2>&1
check BIND local
check PUBLISH_ON '127.0.0.1:'

echo "-- switching to volumes"
sh launch.sh --data volumes -y </dev/null >out.txt 2>&1
check DB_MOUNT 'db:/var/lib/postgresql/data'
check UPLOADS_MOUNT 'uploads:/data'

echo "-- questions (answers piped in)"
fresh
sed 's/^\[ -t 0 \] || ask=0/:/' launch.sh > l2.sh
printf 'nope\nvolumes\nnetwork\n8181\naccounts\ninvite\nboss@x.com\nn\ny\nCorn Retros\ngreen\nsunset\n#zz\n#3b82f6\nsailboat\nwarp\nreplies, presence\n\n' | sh l2.sh >out.txt 2>&1 || { echo "  FAIL exit"; tail -5 out.txt; fail=1; }
check DATA_STORAGE volumes
check ACCESS network
check PORT 8181
check AUTH_MODE accounts
check LOCAL_SIGNUP invite
check ADMIN_EMAILS 'boss@x.com'
check SITE_NAME 'Corn Retros'
check DEFAULT_THEME sunset
check DEFAULT_ACCENT '#3b82f6'
check DEFAULT_TEMPLATE sailboat
check DISABLED_FEATURES 'replies,presence'
grep -q "type one of: folder, volumes" out.txt && echo "  ok   re-asks on a bad answer" || { echo "  FAIL re-ask"; fail=1; }
grep -E '^PUBLIC_URL=http://[0-9.]+:8181$' .env >/dev/null && echo "  ok   network address $(grep ^PUBLIC_URL .env)" || echo "  note no network IP in this container ($(grep ^PUBLIC_URL .env))"

echo "-- bad options"
fresh
for a in "--disable telepathy" "--data cloud" "--theme neon" "--accent red" "--votes 5" "--port x" "--bind lan" "--bogus 1"; do
  if sh launch.sh $a </dev/null >/dev/null 2>&1; then echo "  FAIL accepted $a"; fail=1; else echo "  ok   rejects $a"; fi
done
sh launch.sh --help | grep -q "Your data" && echo "  ok   --help" || { echo "  FAIL --help"; fail=1; }

echo "-- no docker"
nodocker=$(printf %s "$PATH" | sed "s#$WORK/bin:##")
if PATH=$nodocker command -v docker >/dev/null 2>&1; then
  echo "  skip a real docker is installed here"
else
  fresh
  if PATH=$nodocker sh launch.sh -y </dev/null >out.txt 2>&1; then echo "  FAIL ran without docker"; fail=1
  elif grep -q "isn't installed" out.txt; then echo "  ok   explains Docker is missing"
  else echo "  FAIL message"; fail=1; fi
fi

rm -rf "$WORK"
exit $fail
