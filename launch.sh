#!/usr/bin/env sh
# One command to run Retro Board on macOS, Linux, or Windows (Git Bash / WSL). On Windows, launch.cmd does the same.
#
#   ./launch.sh                 asks how to set it up (current values are the defaults), then builds and starts
#   ./launch.sh [options]       sets what you pass, no questions, then builds and starts
#   ./launch.sh -y              starts with the current settings, no questions
#   ./launch.sh update          rebuild after pulling new code (no questions)
#   ./launch.sh backup          save everything (database + uploads) to one file in backups/
#   ./launch.sh backup --encrypt   the same, locked with a passphrase (for copies kept off this computer)
#   ./launch.sh restore FILE    put a backup back
#   ./launch.sh unlock [TEAM]   remove a forgotten team password (no TEAM: list the teams that have one)
#   ./launch.sh stop | logs
#
# Run ./launch.sh --help for the options.
set -e
cd "$(dirname "$0")"

usage() {
  cat <<'EOF'
Usage: ./launch.sh [up|update|stop|logs|backup [--encrypt]|restore FILE|unlock [TEAM]] [options]

backup --encrypt asks for a passphrase (or reads BACKUP_PASSPHRASE) and saves a .tar.gz.enc that can't be
opened without it; restore asks for it again. Keep the passphrase somewhere other than this computer.

With no options, ./launch.sh asks each question below, showing the current value; press Enter to keep it.
Passing any option (or -y) skips the questions. Everything is saved in .env.

Your data (it always stays on this computer)
  --data folder|volumes     folder:  plain folders in ./data next to this script (easy to see, copy, back up)
                            volumes: Docker-managed volumes (Docker keeps them out of sight)
                            Switching moves your existing data across.

Who opens it
  --access local|network|domain
                            local:   only this computer (http://localhost:PORT)
                            network: people on your network, at http://<this computer's IP>:PORT.
                                     The IP is looked up again on every launch
                            domain:  a real address you set up, given with --url
  --network                 same as --access network
  --url URL                 address people open, e.g. https://retro.example.com (sets --access domain)
  --port N                  port on this machine (default 8080)
  --bind local|all          local: only this computer can reach the port (a tunnel or proxy on this
                                   computer passes people in, e.g. cloudflared)
                            all:   any computer that can reach this one
                            Default: local with --access local, all otherwise

Sign-in
  --auth accounts|none      accounts: people sign in to see anything (default)
                            none: no sign-in; anyone who can open the site can do everything,
                                  and gives a name when they first add a card
  --signup open|invite|closed   who can create an email/password account (accounts mode)
  --admin-emails a@x.com,…  emails that become instance admins when they sign up

Sign-in providers (accounts mode; each appears on the login page once set)
  --google-id ID   --google-secret SECRET
  --github-id ID   --github-secret SECRET
  --ms-id ID       --ms-secret SECRET      --ms-tenant TENANT   (default: common)
  --okta-issuer URL  --okta-id ID          --okta-secret SECRET

Look and defaults (admins can change these later in the app: Admin > Customize)
  --site-name NAME          shown in the top bar and browser tab (default: Retro Board)
  --theme NAME              auto (light/dark per device), light, dark, midnight, forest, sunset, grape, high-contrast
  --accent #RRGGBB          accent color on top of the theme
  --columns TEMPLATE        went-well, start-stop-continue, mad-sad-glad, 4ls, sailboat, blank
  --disable LIST            features to switch off for everyone, comma separated, e.g. videos,gifs
                            (images, gifs, videos, anonymous, replies, reactions, likes, groups, actions, carryOver, export, presence, personShades)

Other
  --giphy-key KEY           turns on GIF search (searches go to Giphy; used over Tenor if both are set)
  --tenor-key KEY           turns on GIF search (searches go to Tenor)
  -y, --yes                 don't ask anything
  -h, --help                this help
EOF
}

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
os=$(uname -s)
# The folder this script is in, as people on this OS would write it (C:\... in Git Bash on Windows)
here() { case "$os" in MINGW*|MSYS*|CYGWIN*) pwd -W 2>/dev/null || pwd ;; *) pwd ;; esac; }

# ---- .env helpers ------------------------------------------------------------

get_env() { [ -f .env ] && grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }

set_env() {
  if grep -qE "^$1=" .env; then
    K="$1" V="$2" awk 'BEGIN { FS = "=" } $1 == ENVIRON["K"] { print ENVIRON["K"] "=" ENVIRON["V"]; next } { print }' .env > .env.tmp
    mv .env.tmp .env
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

# This computer's address on the local network (the interface with the default route), or nothing.
lan_ip() {
  found=""
  case "$os" in
    Linux)
      found=$(ip route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }')
      [ -n "$found" ] || found=$(hostname -I 2>/dev/null | awk '{ print $1 }') ;;
    Darwin)
      iface=$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }')
      found=$(ipconfig getifaddr "${iface:-en0}" 2>/dev/null || true) ;;
    MINGW*|MSYS*|CYGWIN*)
      found=$(powershell.exe -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { \$_.IPv4DefaultGateway -and \$_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress" 2>/dev/null | tr -d '\r') ;;
  esac
  case "$found" in *.*.*.*) printf '%s' "$found" ;; esac
}

# "videos,gifs" -> ok when every name is a known feature (empty is fine)
valid_features() {
  [ -z "$1" ] && return 0
  printf '%s\n' "$1" | tr ',' '\n' | while IFS= read -r f; do
    case "$f" in images|gifs|videos|anonymous|replies|reactions|likes|groups|actions|carryOver|export|presence|personShades) ;; *) exit 1 ;; esac
  done
}

# ---- arguments ---------------------------------------------------------------

cmd=up
encrypt=0
restore_file=""
unlock_team=""
case "${1:-}" in
  unlock)
    # everything after it is the team's name (or id)
    cmd=unlock; shift; unlock_team="$*"; set -- ;;
  up|update|stop|logs|backup) cmd=$1; shift ;;
  restore)
    cmd=restore; shift
    [ $# -ge 1 ] || { warn "Usage: ./launch.sh restore backups/<file>.tar.gz"; exit 2; }
    restore_file=$1; shift ;;
esac

ask=1
[ "$cmd" = up ] || ask=0
SETS=""
add_set() { SETS="$SETS$1=$2
"; ask=0; }

while [ $# -gt 0 ]; do
  opt=$1
  case "$opt" in
    -h|--help) usage; exit 0 ;;
    -y|--yes) ask=0; shift; continue ;;
    --network) add_set ACCESS network; shift; continue ;;
    --encrypt) encrypt=1; shift; continue ;;
    --access|--auth|--signup|--admin-emails|--google-*|--github-*|--ms-*|--okta-*|--port|--bind|--url|--giphy-key|--tenor-key) ;;
    --data|--site-name|--theme|--accent|--columns|--disable) ;;
    *) warn "Unknown option $opt (see ./launch.sh --help)"; exit 2 ;;
  esac
  [ $# -ge 2 ] || { warn "$opt needs a value (see ./launch.sh --help)"; exit 2; }
  val=$2
  case "$opt" in
    --auth)
      case "$val" in accounts|none) ;; *) warn "--auth is accounts or none"; exit 2 ;; esac
      add_set AUTH_MODE "$val" ;;
    --signup)
      case "$val" in open|invite|closed) ;; *) warn "--signup is open, invite or closed"; exit 2 ;; esac
      add_set LOCAL_SIGNUP "$val" ;;
    --admin-emails) add_set ADMIN_EMAILS "$val" ;;
    --google-id) add_set GOOGLE_CLIENT_ID "$val" ;;
    --google-secret) add_set GOOGLE_CLIENT_SECRET "$val" ;;
    --github-id) add_set GITHUB_CLIENT_ID "$val" ;;
    --github-secret) add_set GITHUB_CLIENT_SECRET "$val" ;;
    --ms-id) add_set MS_CLIENT_ID "$val" ;;
    --ms-secret) add_set MS_CLIENT_SECRET "$val" ;;
    --ms-tenant) add_set MS_TENANT "$val" ;;
    --okta-issuer) add_set OKTA_ISSUER "$val" ;;
    --okta-id) add_set OKTA_CLIENT_ID "$val" ;;
    --okta-secret) add_set OKTA_CLIENT_SECRET "$val" ;;
    --port)
      case "$val" in ''|*[!0-9]*) warn "--port is a number"; exit 2 ;; esac
      add_set PORT "$val" ;;
    --bind)
      case "$val" in local|all) ;; *) warn "--bind is local or all"; exit 2 ;; esac
      add_set BIND "$val" ;;
    --url) add_set PUBLIC_URL "${val%/}"; add_set ACCESS domain ;;
    --access)
      case "$val" in local|network|domain) ;; *) warn "--access is local, network or domain"; exit 2 ;; esac
      add_set ACCESS "$val" ;;
    --giphy-key) add_set GIPHY_API_KEY "$val" ;;
    --tenor-key) add_set TENOR_API_KEY "$val" ;;
    --data)
      case "$val" in folder|volumes) ;; *) warn "--data is folder or volumes"; exit 2 ;; esac
      add_set DATA_STORAGE "$val" ;;
    --site-name) add_set SITE_NAME "$val" ;;
    --theme)
      case "$val" in auto|light|dark|midnight|forest|sunset|grape|high-contrast) ;; *) warn "--theme is auto, light, dark, midnight, forest, sunset, grape or high-contrast"; exit 2 ;; esac
      add_set DEFAULT_THEME "$val" ;;
    --accent)
      case "$val" in \#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]) ;; *) warn "--accent is a color like #3b82f6"; exit 2 ;; esac
      add_set DEFAULT_ACCENT "$val" ;;
    --columns)
      case "$val" in went-well|start-stop-continue|mad-sad-glad|4ls|sailboat|blank) ;; *) warn "--columns is went-well, start-stop-continue, mad-sad-glad, 4ls, sailboat or blank"; exit 2 ;; esac
      add_set DEFAULT_TEMPLATE "$val" ;;
    --disable)
      val=$(printf '%s' "$val" | tr -d ' ')
      if ! valid_features "$val"; then warn "--disable takes a comma separated list of: images, gifs, videos, anonymous, replies, reactions, likes, groups, actions, carryOver, export, presence, personShades"; exit 2; fi
      add_set DISABLED_FEATURES "$val" ;;
  esac
  shift 2
done

[ "$encrypt" = 0 ] || [ "$cmd" = backup ] || { warn "--encrypt goes with backup: ./launch.sh backup --encrypt"; exit 2; }

# ---- docker ------------------------------------------------------------------

if ! command -v docker >/dev/null 2>&1; then
  warn "Retro Board runs in Docker, which isn't installed yet."
  case "$os" in
    Darwin) warn "Get Docker Desktop for Mac: https://docs.docker.com/desktop/setup/install/mac-install/" ;;
    Linux) warn "Install Docker Engine: https://docs.docker.com/engine/install/ (or: curl -fsSL https://get.docker.com | sh)" ;;
    *) warn "Get Docker Desktop: https://docs.docker.com/get-docker/" ;;
  esac
  warn "Then run ./launch.sh again."
  exit 1
fi

# Docker installed but not running: start it where we can, and wait.
if ! docker info >/dev/null 2>&1; then
  if docker info 2>&1 | grep -qi 'permission denied'; then
    warn "Docker is running but this user can't use it. Either run: sudo ./launch.sh"
    warn "or add yourself to the docker group (sudo usermod -aG docker \$USER), log out and back in."
    exit 1
  fi
  started=""
  case "$os" in
    Darwin) open -a Docker >/dev/null 2>&1 && started=1 ;;
    MINGW*|MSYS*|CYGWIN*)
      for exe in "/c/Program Files/Docker/Docker/Docker Desktop.exe" "$LOCALAPPDATA/Docker/Docker Desktop.exe"; do
        [ -f "$exe" ] && { "$exe" >/dev/null 2>&1 & started=1; break; }
      done ;;
    Linux)
      if command -v systemctl >/dev/null 2>&1 && [ "$(id -u)" = 0 ]; then systemctl start docker && started=1; fi ;;
  esac
  if [ -z "$started" ]; then
    warn "Docker is installed but not running."
    [ "$os" = Linux ] && warn "Start it with: sudo systemctl start docker" || warn "Start Docker Desktop and run this again."
    exit 1
  fi
  printf "Starting Docker"
  i=0
  until docker info >/dev/null 2>&1; do
    i=$((i + 1)); [ "$i" -gt 60 ] && { echo; warn "Docker didn't start within 2 minutes. Start it yourself and run this again."; exit 1; }
    printf "."; sleep 2
  done
  echo
fi

# Docker Compose v2.24+ (the "docker compose" plugin) is needed for the optional .env file.
if ! docker compose version >/dev/null 2>&1; then
  warn "This needs Docker Compose v2 (\"docker compose\"). Update Docker Desktop, or on Linux install the"
  warn "docker-compose-plugin package: https://docs.docker.com/compose/install/linux/"
  exit 1
fi
cv=$(docker compose version --short 2>/dev/null | sed 's/^v//')
cmaj=$(echo "$cv" | cut -d. -f1); cmin=$(echo "$cv" | cut -d. -f2)
if [ "${cmaj:-0}" -lt 2 ] 2>/dev/null || { [ "${cmaj:-0}" -eq 2 ] && [ "${cmin:-0}" -lt 24 ]; } 2>/dev/null; then
  warn "Docker Compose $cv is too old (needs 2.24 or newer). Update Docker Desktop or the docker-compose-plugin."
  exit 1
fi

dc() { docker compose "$@"; }

# ---- backup / restore --------------------------------------------------------

running() { [ -n "$(dc ps -q --status running "$1" 2>/dev/null)" ]; }

ensure_up() {
  if ! running db || ! running app; then
    dc up -d >/dev/null 2>&1 || { warn "Couldn't start Retro Board to read its data. Run ./launch.sh first."; exit 1; }
    i=0; until dc exec -T db pg_isready -U retro >/dev/null 2>&1; do i=$((i + 1)); [ "$i" -gt 60 ] && break; sleep 2; done
  fi
}

do_backup() { # do_backup [file] -> prints the file written
  ensure_up
  mkdir -p backups
  out=${1:-backups/retro-board-$(date +%Y-%m-%d_%H%M%S).tar.gz}
  tmp=$(mktemp -d)
  # Unique names inside the containers, removed again, so runs never trip over each other's leftovers.
  n=rb-$(date +%s)-$$
  dc exec -T db sh -c "pg_dump -U retro -Fc retro > /tmp/$n.dump"
  dc cp "db:/tmp/$n.dump" "$tmp/database.dump" >/dev/null 2>&1
  dc exec -T db sh -c "rm -f /tmp/$n.dump"
  dc exec -T app sh -c "mkdir -p /data/uploads && cd /data && tar czf /tmp/$n.tgz uploads"
  dc cp "app:/tmp/$n.tgz" "$tmp/uploads.tgz" >/dev/null 2>&1
  dc exec -T app sh -c "rm -f /tmp/$n.tgz"
  (cd "$tmp" && tar czf - database.dump uploads.tgz) > "$out"
  rm -rf "$tmp"
  [ -s "$out" ] || { warn "The backup failed: couldn't write $out"; exit 1; }
  printf '%s' "$out"
}

do_restore() { # do_restore file
  [ -f "$1" ] || { warn "No backup at $1"; exit 1; }
  ensure_up
  tmp=$(mktemp -d)
  tar xzf "$1" -C "$tmp"
  if [ -f "$tmp/retro-board-backup.json" ]; then
    rm -rf "$tmp"
    warn "$1 was made in the app (Admin > Customize > Your Data). Restore it there: Restore from Backup."; exit 1
  fi
  [ -f "$tmp/database.dump" ] || { warn "$1 isn't a Retro Board backup"; rm -rf "$tmp"; exit 1; }
  n=rb-$(date +%s)-$$
  dc stop app >/dev/null 2>&1
  dc cp "$tmp/database.dump" "db:/tmp/$n.dump" >/dev/null 2>&1
  # A fresh, empty database first, so the backup comes back exactly as it was (and newer app versions can
  # upgrade it as usual on start).
  dc exec -T db sh -c 'psql -q -U retro -d postgres -c "DROP DATABASE IF EXISTS retro WITH (FORCE)" -c "CREATE DATABASE retro OWNER retro"' >/dev/null
  dc exec -T db sh -c "pg_restore -U retro -d retro --no-owner /tmp/$n.dump" 2>/dev/null || true
  dc exec -T db sh -c "rm -f /tmp/$n.dump"
  dc start app >/dev/null 2>&1
  i=0; until running app; do i=$((i + 1)); [ "$i" -gt 30 ] && break; sleep 1; done
  if [ -f "$tmp/uploads.tgz" ]; then
    dc cp "$tmp/uploads.tgz" "app:/tmp/$n.tgz" >/dev/null 2>&1
    dc exec -T app sh -c "mkdir -p /data/uploads && rm -rf /data/uploads/* && tar xzf /tmp/$n.tgz -C /data/uploads --strip-components=1 -m --no-overwrite-dir"
    dc exec -T -u root app sh -c "rm -f /tmp/$n.tgz"
  fi
  rm -rf "$tmp"
  dc restart app >/dev/null 2>&1
}

# ---- encrypted backups -------------------------------------------------------
# The app container does the crypto (node dist/cli.js encrypt|decrypt); the passphrase goes in on stdin,
# so it never shows on a command line. BACKUP_PASSPHRASE skips the question (for cron).

ask_pass() { # ask_pass [confirm] -> sets $pass
  if [ -n "${BACKUP_PASSPHRASE:-}" ]; then pass=$BACKUP_PASSPHRASE; return; fi
  [ -t 0 ] || { warn "No terminal to ask for the backup passphrase: set BACKUP_PASSPHRASE"; exit 1; }
  printf 'Backup passphrase (8 or more characters): '; stty -echo; read -r pass || pass=""; stty echo; printf '\n'
  if [ "${1:-}" = confirm ]; then
    [ ${#pass} -ge 8 ] || { warn "The passphrase needs at least 8 characters. Nothing saved."; exit 1; }
    printf 'Same again: '; stty -echo; read -r again || again=""; stty echo; printf '\n'
    [ "$pass" = "$again" ] || { warn "The two passphrases don't match. Nothing saved."; exit 1; }
  fi
}

is_encrypted() { [ "$(dd if="$1" bs=6 count=1 2>/dev/null)" = RBENC1 ]; }

crypt_file() { # crypt_file encrypt|decrypt IN OUT
  n=rb-$(date +%s)-$$
  dc cp "$2" "app:/tmp/$n.in" >/dev/null 2>&1
  if printf '%s' "$pass" | dc exec -T app node dist/cli.js "$1" "/tmp/$n.in" "/tmp/$n.out"; then
    dc cp "app:/tmp/$n.out" "$3" >/dev/null 2>&1; ok=0
  else ok=1; fi
  dc exec -T -u root app rm -f "/tmp/$n.in" "/tmp/$n.out" >/dev/null 2>&1 || true
  [ "$ok" = 0 ] && [ -s "$3" ]
}

case "$cmd" in
  stop) dc down; exit 0 ;;
  logs) dc logs -f app; exit 0 ;;
  backup)
    [ -f .env ] || { warn "Nothing to back up yet: run ./launch.sh first."; exit 1; }
    [ "$encrypt" = 1 ] && ask_pass confirm
    f=$(do_backup)
    if [ "$encrypt" = 1 ]; then
      crypt_file encrypt "$f" "$f.enc" || { rm -f "$f" "$f.enc"; warn "Couldn't encrypt the backup, so none was kept."; exit 1; }
      rm -f "$f"; f="$f.enc"
      say "Saved everything (database and uploads), encrypted, to $f"
      say "Without the passphrase it can't be opened, so keep that somewhere other than this computer."
    else
      say "Saved everything (database and uploads) to $f"
    fi
    say "Put it back any time with: ./launch.sh restore $f"
    exit 0 ;;
  unlock)
    [ -f .env ] || { warn "Run ./launch.sh once first."; exit 1; }
    ensure_up
    if [ -n "$unlock_team" ]; then dc exec -T app node dist/cli.js unlock "$unlock_team"
    else dc exec -T app node dist/cli.js unlock; fi
    exit $? ;;
  restore)
    [ -f .env ] || { warn "Run ./launch.sh once first, then restore."; exit 1; }
    say "This replaces all current data with the backup in $restore_file."
    if [ -t 0 ]; then printf 'Continue? [y/N]: '; read -r a || a=""; case "$a" in y|Y|yes) ;; *) say "Nothing changed."; exit 0 ;; esac; fi
    src=$restore_file; plain=""
    if [ -f "$src" ] && is_encrypted "$src"; then
      ask_pass; ensure_up; plain=$(mktemp)
      crypt_file decrypt "$src" "$plain" || { rm -f "$plain"; warn "Couldn't open $src: wrong passphrase, or the file is damaged. Nothing changed."; exit 1; }
      src=$plain
    fi
    do_restore "$src"
    [ -n "$plain" ] && rm -f "$plain"
    say "Restored from $restore_file."
    exit 0 ;;
esac

# ---- settings ----------------------------------------------------------------

first_run=""
if [ ! -f .env ]; then
  secret=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
  sed "s/^SESSION_SECRET=.*/SESSION_SECRET=$secret/" .env.example > .env
  first_run=1
  say "Created .env with a random SESSION_SECRET"
fi
old_storage=$(get_env DATA_STORAGE)
# Installs from before the data choice existed keep their data in Docker volumes.
if [ -z "$old_storage" ] && [ -z "$first_run" ]; then old_storage=volumes; fi

# options passed on the command line
printf '%s' "$SETS" | while IFS= read -r line; do
  [ -n "$line" ] && set_env "${line%%=*}" "${line#*=}"
done

# questions, only for a bare ./launch.sh in a terminal
[ -t 0 ] || ask=0

prompt() { # prompt VAR "Question" [default]
  printf '%s [%s]: ' "$2" "$3" >&2
  read -r answer || answer=""
  eval "$1=\${answer:-\$3}"
}

prompt_secret() { # prompt_secret VAR "Question" — Enter keeps the current value
  printf '%s [%s]: ' "$2" "$( [ -n "$3" ] && echo 'set, Enter keeps it' || echo 'not set' )" >&2
  stty -echo 2>/dev/null || true
  read -r answer || answer=""
  stty echo 2>/dev/null || true
  echo >&2
  eval "$1=\${answer:-\$3}"
}

yes_no() { # yes_no "Question" default(y|n)
  printf '%s [%s]: ' "$1" "$( [ "$2" = y ] && echo Y/n || echo y/N )" >&2
  read -r answer || answer=""
  case "${answer:-$2}" in y|Y|yes|Yes) return 0 ;; *) return 1 ;; esac
}

choose() { # choose VAR "Question" default "a|b|c" — asks until the answer is one of the choices
  while :; do
    prompt picked "$2" "$3"
    if printf '%s' "|$4|" | grep -q "|$picked|"; then eval "$1=\$picked"; return; fi
    say "  type one of: $(printf '%s' "$4" | sed 's/|/, /g')"
  done
}

provider() { # provider Label ID_VAR SECRET_VAR [extra VAR "Question" default]
  label=$1; idv=$2; secv=$3
  cur_id=$(get_env "$idv"); cur_secret=$(get_env "$secv")
  if [ -n "$cur_id" ]; then state=on; def=y; else state=off; def=n; fi
  if yes_no "  $label sign-in (now $state)?" "$def"; then
    if [ -n "${4:-}" ]; then
      cur_extra=$(get_env "$4")
      prompt extra "    $5" "${cur_extra:-$6}"
      set_env "$4" "$extra"
    fi
    prompt new_id "    Client ID" "$cur_id"
    prompt_secret new_secret "    Client secret" "$cur_secret"
    set_env "$idv" "$new_id"; set_env "$secv" "$new_secret"
  elif [ -n "$cur_id" ]; then
    set_env "$idv" ""; set_env "$secv" ""
    say "    $label turned off"
  fi
}

if [ "$ask" = 1 ]; then
  say ""
  say "Retro Board setup. Press Enter to keep the value in [brackets]. (./launch.sh -y skips this.)"
  say ""
  say "1. Where should your data live? It stays on this computer either way; nothing is sent anywhere."
  say "   folder   plain folders in $(here)/data, easy to see, copy and back up"
  say "   volumes  Docker-managed storage, out of sight"
  storage=$(get_env DATA_STORAGE)
  choose storage "Data" "${storage:-${old_storage:-folder}}" "folder|volumes"
  set_env DATA_STORAGE "$storage"

  say ""
  say "2. Who will open it?"
  say "   local    just this computer"
  say "   network  people on your network (office, VPN): you get an address to send them"
  say "   domain   a real web address you've set up (https://retro.example.com)"
  access=$(get_env ACCESS)
  choose access "Access" "${access:-local}" "local|network|domain"
  set_env ACCESS "$access"
  if [ "$access" = domain ]; then
    url=$(get_env PUBLIC_URL)
    case "$url" in http://localhost:*|http://[0-9]*) url="" ;; esac
    prompt url "   Address people open" "$url"; set_env PUBLIC_URL "${url%/}"
  fi
  port=$(get_env PORT); prompt port "   Port" "${port:-8080}"; set_env PORT "$port"

  say ""
  say "3. How do people get in?"
  say "   accounts  sign in with email/password or Google, GitHub, Microsoft, Okta"
  say "   none      no sign-in: anyone who can open the site can do everything,"
  say "             and is asked for a name when they first add a card (trusted networks only)"
  mode=$(get_env AUTH_MODE)
  choose mode "Sign-in" "${mode:-accounts}" "accounts|none"
  set_env AUTH_MODE "$mode"
  if [ "$mode" = accounts ]; then
    signup=$(get_env LOCAL_SIGNUP)
    say "   Who can create an email/password account? open (anyone), invite (team invite link only), closed"
    choose signup "   Sign-up" "${signup:-open}" "open|invite|closed"
    set_env LOCAL_SIGNUP "$signup"
    prompt admins "   Admin emails, comma separated (the first account is always admin)" "$(get_env ADMIN_EMAILS)"
    set_env ADMIN_EMAILS "$admins"
    if yes_no "   Set up Google, GitHub, Microsoft or Okta sign-in now? (steps in docs/auth.md)" n; then
      provider Google GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
      provider GitHub GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET
      provider Microsoft MS_CLIENT_ID MS_CLIENT_SECRET MS_TENANT "Tenant (common = any Microsoft account)" common
      provider Okta OKTA_CLIENT_ID OKTA_CLIENT_SECRET OKTA_ISSUER "Issuer, e.g. https://your-org.okta.com" ""
    fi
  fi

  say ""
  say "4. Look and defaults. Admins can change all of this later in the app (Admin > Customize)."
  if yes_no "   Customize now?" n; then
    name=$(get_env SITE_NAME); prompt name "   Site name" "${name:-Retro Board}"; set_env SITE_NAME "$name"
    theme=$(get_env DEFAULT_THEME)
    choose theme "   Theme (auto = light/dark per device; light, dark, midnight, forest, sunset, grape, high-contrast)" "${theme:-auto}" "auto|light|dark|midnight|forest|sunset|grape|high-contrast"
    set_env DEFAULT_THEME "$theme"
    while :; do
      accent=$(get_env DEFAULT_ACCENT); prompt accent "   Accent color, like #3b82f6 (Enter for the theme's own)" "$accent"
      case "$accent" in ''|\#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]) break ;; *) say "   use # and six hex digits" ;; esac
    done
    set_env DEFAULT_ACCENT "$accent"
    cols=$(get_env DEFAULT_TEMPLATE)
    say "   Columns for new boards: went-well (Went well / To improve / Action ideas), start-stop-continue,"
    say "   mad-sad-glad, 4ls (Liked / Learned / Lacked / Longed for), sailboat, blank"
    choose cols "   Columns" "${cols:-went-well}" "went-well|start-stop-continue|mad-sad-glad|4ls|sailboat|blank"
    set_env DEFAULT_TEMPLATE "$cols"
    say "   Features you can switch off for everyone: images, gifs, videos, anonymous, replies, reactions, likes, groups, actions, carryOver, export, presence, personShades"
    while :; do
      off=$(get_env DISABLED_FEATURES); prompt off "   Switch off (comma separated, Enter for none)" "$off"
      off=$(printf '%s' "$off" | tr -d ' ')
      if valid_features "$off"; then break; fi
      say "   use names from the list, separated by commas"
    done
    set_env DISABLED_FEATURES "$off"
  fi

  say ""
  say "5. GIF search (optional): a Giphy or Tenor API key turns on the GIF button. Enter to skip either"
  prompt_secret giphy "   Giphy API key (searches go to Giphy; used if both are set)" "$(get_env GIPHY_API_KEY)"
  set_env GIPHY_API_KEY "$giphy"
  prompt_secret tenor "   Tenor API key (searches go to Tenor)" "$(get_env TENOR_API_KEY)"
  set_env TENOR_API_KEY "$tenor"
  say ""
fi

# ---- where the data lives ----------------------------------------------------

storage=$(get_env DATA_STORAGE)
if [ -z "$storage" ]; then
  storage=${old_storage:-folder}
  set_env DATA_STORAGE "$storage"
fi
# Switching storage with data already in the old place: carry it across with a backup and restore.
moving=""
if [ -n "$old_storage" ] && [ "$old_storage" != "$storage" ] && running db; then
  say "Moving your data from $old_storage to $storage storage..."
  moving=$(do_backup "backups/before-move-to-$storage-$(date +%Y-%m-%d_%H%M%S).tar.gz")
  say "  Saved a copy to $moving (the old $old_storage storage is left as it was)"
  dc down >/dev/null 2>&1
fi
if [ "$storage" = folder ]; then
  mkdir -p data/postgres data/uploads
  set_env DB_MOUNT "./data/postgres:/var/lib/postgresql/data"
  set_env UPLOADS_MOUNT "./data/uploads:/data/uploads"
  # On Linux the app writes uploads as you, so the files in ./data/uploads are yours.
  if [ "$os" = Linux ] && [ "$(id -u)" != 0 ]; then set_env APP_UID "$(id -u)"; set_env APP_GID "$(id -g)"; fi
  set_env DATA_LOCATION "$(here)/data on this computer"
else
  set_env DATA_LOCATION "Docker volumes retro-board_db and retro-board_uploads on this computer"
  set_env DB_MOUNT "db:/var/lib/postgresql/data"
  set_env UPLOADS_MOUNT "uploads:/data"
  set_env APP_UID ""; set_env APP_GID ""
fi

# ---- address -----------------------------------------------------------------

# Sets $port and $url from the settings, and saves PUBLIC_URL.
work_out_address() {
  port=$(get_env PORT); port=${port:-8080}
  url=$(get_env PUBLIC_URL)
  access=$(get_env ACCESS)
  if [ -z "$access" ]; then # .env from before ACCESS existed: work it out from the address
    case "$url" in ''|http://localhost:*) access=local ;; http://10.*|http://192.168.*|http://172.*) access=network ;; *) access=domain ;; esac
    set_env ACCESS "$access"
  fi
  case "$access" in
    local) url="http://localhost:$port" ;;
    network)
      ip=$(lan_ip)
      if [ -n "$ip" ]; then
        new="http://$ip:$port"
        case "$url" in "$new"|''|http://localhost:*) ;; *) say "Network address changed: $url -> $new" ;; esac
        url=$new
      else
        warn "Couldn't find this computer's network address; keeping ${url:-http://localhost:$port}."
        warn "Set it yourself with ./launch.sh --url http://<ip>:$port"
        url=${url:-http://localhost:$port}
      fi ;;
    domain) url=${url:-http://localhost:$port} ;;
  esac
  set_env PUBLIC_URL "$url"
  # Who can reach the port: Docker otherwise publishes it on every network the computer is on
  bind=$(get_env BIND)
  if [ -z "$bind" ]; then if [ "$access" = local ]; then bind=local; else bind=all; fi; fi
  if [ "$bind" = local ]; then set_env PUBLISH_ON "127.0.0.1:"; else set_env PUBLISH_ON ""; fi
}
work_out_address
mode=$(get_env AUTH_MODE)

# ---- start -------------------------------------------------------------------

log=$(mktemp)
while :; do
  if dc up -d --build >"$log" 2>&1; then cat "$log"; break; fi
  cat "$log" >&2
  if grep -qiE 'port is already allocated|address already in use|ports are not available' "$log"; then
    warn ""
    warn "Port $port is already used by another program on this computer."
    if [ -t 0 ]; then
      prompt newport "Pick another port" "$((port + 1))"
      set_env PORT "$newport"
      work_out_address
      continue
    fi
    warn "Run it on another port with: ./launch.sh --port $((port + 1))"
  fi
  rm -f "$log"
  exit 1
done
rm -f "$log"

printf "Waiting for Retro Board to start (the first start takes a minute or two)"
i=0
until dc exec -T app node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 120 ]; then
    echo; warn "It did not come up. Recent logs:"
    dc logs --tail 40 app >&2
    exit 1
  fi
  printf "."; sleep 2
done
echo

if [ -n "$moving" ]; then
  do_restore "$moving"
  say "Moved your data to $storage storage."
fi

say ""
say "Retro Board is running at $url"
say ""
if [ "$storage" = folder ]; then
  say "Your data stays on this computer, in $(here)/data"
else
  say "Your data stays on this computer, in Docker volumes (retro-board_db, retro-board_uploads)"
fi
say "  Back it up any time with: ./launch.sh backup"
if [ "$access" = network ]; then
  say ""
  say "Send people this address: $url"
  say "  They need to be on the same network. This computer has to stay on with Docker running."
  say "  If they can't connect, allow port $port through this computer's firewall"
  case "$os" in
    Linux) say "  (e.g. sudo ufw allow $port/tcp)." ;;
    MINGW*|MSYS*|CYGWIN*) say "  (launch.cmd offers to do this for you)." ;;
    *) say "  (System Settings > Network > Firewall)." ;;
  esac
fi
say ""
if [ "$mode" = none ]; then
  say "No sign-in: anyone who can open that address can see and change everything."
else
  say "The first account you create becomes the admin. Customize the look and defaults in Admin > Customize."
  for p in google:GOOGLE_CLIENT_ID github:GITHUB_CLIENT_ID microsoft:MS_CLIENT_ID okta:OKTA_CLIENT_ID; do
    if [ -n "$(get_env "${p#*:}")" ]; then say "  ${p%%:*} redirect URL: $url/api/auth/${p%%:*}/callback"; fi
  done
  if [ "$access" = network ] && [ -n "$(get_env GOOGLE_CLIENT_ID)$(get_env MS_CLIENT_ID)$(get_env OKTA_CLIENT_ID)" ]; then
    say "  Note: Google, Microsoft and Okta won't redirect back to a plain network IP address."
    say "  On a network, use email/password, GitHub, or no sign-in (--auth none)."
  fi
fi
( command -v open >/dev/null && open "$url" ) || ( command -v xdg-open >/dev/null && xdg-open "$url" ) >/dev/null 2>&1 || true
