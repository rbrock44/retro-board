#!/usr/bin/env sh
# One command to run Retro Board.
#
#   ./launch.sh                 asks how to set it up (current values are the defaults), then builds and starts
#   ./launch.sh [options]       sets what you pass, no questions, then builds and starts
#   ./launch.sh -y              starts with the current settings, no questions
#   ./launch.sh --network       share it on your network (prints the address to give people)
#   ./launch.sh update          rebuild after pulling new code (no questions)
#   ./launch.sh stop            stop it
#   ./launch.sh logs            follow the logs
#
# Run ./launch.sh --help for the options.
set -e
cd "$(dirname "$0")"

usage() {
  cat <<'EOF'
Usage: ./launch.sh [up|update|stop|logs] [options]

With no options, ./launch.sh asks each question below, showing the current value; press Enter to keep it.
Passing any option (or -y) skips the questions. Everything is saved in .env.

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

Who opens it
  --access local|network|domain
                            local:   only this computer (http://localhost:PORT)
                            network: people on your network, at http://<this computer's IP>:PORT.
                                     The IP is looked up again on every launch
                            domain:  a real address you set up, given with --url
  --network                 same as --access network
  --url URL                 address people open, e.g. https://retro.example.com (sets --access domain)

Server
  --port N                  port on this machine (default 8080)
  --tenor-key KEY           turns on GIF search

  -y, --yes                 don't ask anything
  -h, --help                this help
EOF
}

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
  case "$(uname -s)" in
    Linux)
      found=$(ip route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }')
      [ -n "$found" ] || found=$(hostname -I 2>/dev/null | awk '{ print $1 }') ;;
    Darwin)
      iface=$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }')
      found=$(ipconfig getifaddr "${iface:-en0}" 2>/dev/null) ;;
    MINGW*|MSYS*|CYGWIN*)
      found=$(powershell.exe -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { \$_.IPv4DefaultGateway -and \$_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress" 2>/dev/null | tr -d '\r') ;;
  esac
  case "$found" in *.*.*.*) printf '%s' "$found" ;; esac
}

# ---- arguments ---------------------------------------------------------------

cmd=up
case "${1:-}" in
  up|update|stop|logs) cmd=$1; shift ;;
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
    --access|--auth|--signup|--admin-emails|--google-*|--github-*|--ms-*|--okta-*|--port|--url|--tenor-key) ;;
    *) echo "Unknown option $opt (see ./launch.sh --help)" >&2; exit 2 ;;
  esac
  [ $# -ge 2 ] || { echo "$opt needs a value (see ./launch.sh --help)" >&2; exit 2; }
  val=$2
  case "$opt" in
    --auth)
      case "$val" in accounts|none) ;; *) echo "--auth is accounts or none" >&2; exit 2 ;; esac
      add_set AUTH_MODE "$val" ;;
    --signup)
      case "$val" in open|invite|closed) ;; *) echo "--signup is open, invite or closed" >&2; exit 2 ;; esac
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
    --port) add_set PORT "$val" ;;
    --url) add_set PUBLIC_URL "${val%/}"; add_set ACCESS domain ;;
    --access)
      case "$val" in local|network|domain) ;; *) echo "--access is local, network or domain" >&2; exit 2 ;; esac
      add_set ACCESS "$val" ;;
    --tenor-key) add_set TENOR_API_KEY "$val" ;;
    *) echo "Unknown option $opt (see ./launch.sh --help)" >&2; exit 2 ;;
  esac
  shift 2
done

# ---- docker ------------------------------------------------------------------

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Get it from https://docs.docker.com/get-docker/" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but not running. Start Docker and try again." >&2
  exit 1
fi

case "$cmd" in
  stop) docker compose down; exit 0 ;;
  logs) docker compose logs -f app; exit 0 ;;
esac

# ---- settings ----------------------------------------------------------------

if [ ! -f .env ]; then
  secret=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
  sed "s/^SESSION_SECRET=.*/SESSION_SECRET=$secret/" .env.example > .env
  echo "Created .env with a random SESSION_SECRET"
fi

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
    echo "    $label turned off"
  fi
}

if [ "$ask" = 1 ]; then
  echo
  echo "Retro Board setup. Press Enter to keep the value in [brackets]. (./launch.sh -y skips this.)"
  echo
  mode=$(get_env AUTH_MODE); mode=${mode:-accounts}
  echo "How do people get in?"
  echo "  accounts  sign in with email/password or Google, GitHub, Microsoft, Okta"
  echo "  none      no sign-in: anyone who can open the site can do everything,"
  echo "            and is asked for a name when they first add a card"
  while :; do
    prompt picked "Sign-in" "$mode"
    case "$picked" in accounts|none) mode=$picked; break ;; *) echo "  type accounts or none" ;; esac
  done
  set_env AUTH_MODE "$mode"

  if [ "$mode" = accounts ]; then
    signup=$(get_env LOCAL_SIGNUP); signup=${signup:-open}
    echo
    echo "Who can create an email/password account? open (anyone), invite (team invite link only), closed"
    while :; do
      prompt picked "Sign-up" "$signup"
      case "$picked" in open|invite|closed) signup=$picked; break ;; *) echo "  type open, invite or closed" ;; esac
    done
    set_env LOCAL_SIGNUP "$signup"
    prompt admins "Admin emails, comma separated (the first account is always admin)" "$(get_env ADMIN_EMAILS)"
    set_env ADMIN_EMAILS "$admins"

    echo
    echo "Sign-in providers. Setup steps for each are in docs/auth.md."
    provider Google GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
    provider GitHub GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET
    provider Microsoft MS_CLIENT_ID MS_CLIENT_SECRET MS_TENANT "Tenant (common = any Microsoft account)" common
    provider Okta OKTA_CLIENT_ID OKTA_CLIENT_SECRET OKTA_ISSUER "Issuer, e.g. https://your-org.okta.com" ""
  fi

  echo
  port=$(get_env PORT); prompt port "Port" "${port:-8080}"; set_env PORT "$port"
  echo
  echo "Who will open it?"
  echo "  local    just this computer"
  echo "  network  people on your network (office, VPN): you get an address to send them"
  echo "  domain   a real web address you've set up (https://retro.example.com)"
  access=$(get_env ACCESS); access=${access:-local}
  while :; do
    prompt picked "Access" "$access"
    case "$picked" in local|network|domain) access=$picked; break ;; *) echo "  type local, network or domain" ;; esac
  done
  set_env ACCESS "$access"
  if [ "$access" = domain ]; then
    url=$(get_env PUBLIC_URL)
    case "$url" in http://localhost:*|http://[0-9]*) url="" ;; esac
    prompt url "Address people open" "$url"; set_env PUBLIC_URL "${url%/}"
  fi
  prompt_secret tenor "Tenor API key for GIF search (optional)" "$(get_env TENOR_API_KEY)"
  set_env TENOR_API_KEY "$tenor"
  echo
fi

# ---- address -----------------------------------------------------------------

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
      case "$url" in "$new"|'') ;; http://localhost:*) ;; *) echo "Network address changed: $url -> $new" ;; esac
      url=$new
    else
      echo "Couldn't find this computer's network address; keeping ${url:-http://localhost:$port}." >&2
      echo "Set it yourself with ./launch.sh --url http://<ip>:$port" >&2
      url=${url:-http://localhost:$port}
    fi ;;
  domain) url=${url:-http://localhost:$port} ;;
esac
set_env PUBLIC_URL "$url"
mode=$(get_env AUTH_MODE)

# ---- start -------------------------------------------------------------------

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
if [ "$access" = network ]; then
  echo
  echo "  Send people this address: $url"
  echo "  They need to be on the same network. This computer has to stay on with Docker running."
  echo "  If they can't connect, allow port $port through this computer's firewall"
  case "$(uname -s)" in
    Linux) echo "  (e.g. sudo ufw allow $port/tcp)." ;;
    MINGW*|MSYS*|CYGWIN*) echo "  (launch.cmd offers to do this for you)." ;;
    *) echo "  (System Settings > Network > Firewall)." ;;
  esac
  echo
fi
if [ "$mode" = none ]; then
  echo "No sign-in: anyone who can open that address can see and change everything."
else
  echo "The first account you create becomes the admin."
  for p in google:GOOGLE_CLIENT_ID github:GITHUB_CLIENT_ID microsoft:MS_CLIENT_ID okta:OKTA_CLIENT_ID; do
    [ -n "$(get_env "${p#*:}")" ] && echo "  ${p%%:*} redirect URL: $url/api/auth/${p%%:*}/callback"
  done
  if [ "$access" = network ] && [ -n "$(get_env GOOGLE_CLIENT_ID)$(get_env MS_CLIENT_ID)$(get_env OKTA_CLIENT_ID)" ]; then
    echo "  Note: Google, Microsoft and Okta won't redirect back to a plain network IP address."
    echo "  On a network, use email/password, GitHub, or no sign-in (--auth none)."
  fi
fi
( command -v open >/dev/null && open "$url" ) || ( command -v xdg-open >/dev/null && xdg-open "$url" ) >/dev/null 2>&1 || true
