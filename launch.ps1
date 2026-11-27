# One command to run Retro Board on Windows. Use launch.cmd (it runs this file); same options as launch.sh.
#
#   launch.cmd                 asks how to set it up (current values are the defaults), then builds and starts
#   launch.cmd [options]       sets what you pass, no questions, then builds and starts
#   launch.cmd -y              starts with the current settings, no questions
#   launch.cmd update          rebuild after pulling new code (no questions)
#   launch.cmd backup          save everything (database + uploads) to one file in backups\
#   launch.cmd restore FILE    put a backup back
#   launch.cmd stop | logs
#
# launch.cmd --help lists the options. Works in Windows PowerShell 5.1 and PowerShell 7.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$usage = @'
Usage: launch.cmd [up|update|stop|logs|backup|restore FILE] [options]

With no options, launch.cmd asks each question below, showing the current value; press Enter to keep it.
Passing any option (or -y) skips the questions. Everything is saved in .env.

Your data (it always stays on this computer)
  --data folder|volumes     folder:  plain folders in .\data next to this script (easy to see, copy, back up)
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

Sign-in
  --auth accounts|none      accounts: people sign in to see anything (default)
                            none: no sign-in; anyone who can open the site can do everything,
                                  and gives a name when they first add a card
  --signup open|invite|closed   who can create an email/password account (accounts mode)
  --admin-emails a@x.com,...    emails that become instance admins when they sign up

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
'@

function Fail([string]$msg, [int]$code = 1) { [Console]::Error.WriteLine($msg); exit $code }

# Runs a native command without PowerShell turning its stderr into errors; returns the exit code.
function Invoke-Quiet([scriptblock]$block) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $block *> $null; return $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
}

# ---- .env helpers ------------------------------------------------------------

$utf8 = New-Object System.Text.UTF8Encoding $false
$envPath = Join-Path $PWD '.env'

function Read-EnvLines { if (Test-Path $envPath) { [IO.File]::ReadAllLines($envPath) } else { @() } }

function Get-EnvValue([string]$key) {
  $line = Read-EnvLines | Where-Object { $_ -like "$key=*" } | Select-Object -Last 1
  if ($line) { $line.Substring($key.Length + 1) } else { '' }
}

function Set-EnvValue([string]$key, [string]$value) {
  $lines = [Collections.Generic.List[string]]@(Read-EnvLines)
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -like "$key=*") { $lines[$i] = "$key=$value"; $found = $true }
  }
  if (-not $found) { $lines.Add("$key=$value") }
  [IO.File]::WriteAllText($envPath, (($lines -join "`n") + "`n"), $utf8)
}

# This computer's address on the local network (the adapter with the default route), or nothing.
function Get-LanIp {
  try {
    $cfg = Get-NetIPConfiguration -ErrorAction Stop |
      Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
    if ($cfg) { return @($cfg.IPv4Address)[0].IPAddress }
  } catch {}
  return ''
}

$featureNames = @('images', 'gifs', 'videos', 'anonymous', 'replies', 'reactions', 'likes', 'groups', 'actions', 'carryOver', 'export', 'presence', 'personShades')
# "videos,gifs" -> true when every name is a known feature (empty is fine)
function Test-Features([string]$list) {
  if (-not $list) { return $true }
  foreach ($f in $list.Split(',')) { if ($featureNames -cnotcontains $f) { return $false } }
  return $true
}

# ---- arguments ---------------------------------------------------------------

$argList = @($args)
$cmd = 'up'
$restoreFile = ''
if ($argList.Count -gt 0 -and @('up', 'update', 'stop', 'logs', 'backup', 'restore') -contains $argList[0]) {
  $cmd = $argList[0]
  $argList = @($argList | Select-Object -Skip 1)
  if ($cmd -eq 'restore') {
    if ($argList.Count -lt 1) { Fail 'Usage: launch.cmd restore backups\<file>.tar.gz' 2 }
    $restoreFile = [string]$argList[0]
    $argList = @($argList | Select-Object -Skip 1)
  }
}
$ask = $cmd -eq 'up'

$optionKeys = [ordered]@{
  '--admin-emails' = 'ADMIN_EMAILS'
  '--google-id' = 'GOOGLE_CLIENT_ID'; '--google-secret' = 'GOOGLE_CLIENT_SECRET'
  '--github-id' = 'GITHUB_CLIENT_ID'; '--github-secret' = 'GITHUB_CLIENT_SECRET'
  '--ms-id' = 'MS_CLIENT_ID'; '--ms-secret' = 'MS_CLIENT_SECRET'; '--ms-tenant' = 'MS_TENANT'
  '--okta-issuer' = 'OKTA_ISSUER'; '--okta-id' = 'OKTA_CLIENT_ID'; '--okta-secret' = 'OKTA_CLIENT_SECRET'
  '--port' = 'PORT'; '--url' = 'PUBLIC_URL'; '--giphy-key' = 'GIPHY_API_KEY'; '--tenor-key' = 'TENOR_API_KEY'
  '--auth' = 'AUTH_MODE'; '--signup' = 'LOCAL_SIGNUP'; '--access' = 'ACCESS'
  '--data' = 'DATA_STORAGE'; '--site-name' = 'SITE_NAME'; '--theme' = 'DEFAULT_THEME'; '--accent' = 'DEFAULT_ACCENT'
  '--columns' = 'DEFAULT_TEMPLATE'; '--disable' = 'DISABLED_FEATURES'
}
$choices = @{
  '--auth' = @('accounts', 'none'); '--signup' = @('open', 'invite', 'closed'); '--access' = @('local', 'network', 'domain')
  '--data' = @('folder', 'volumes')
  '--theme' = @('auto', 'light', 'dark', 'midnight', 'forest', 'sunset', 'grape', 'high-contrast')
  '--columns' = @('went-well', 'start-stop-continue', 'mad-sad-glad', '4ls', 'sailboat', 'blank')
}
$sets = [ordered]@{}

for ($i = 0; $i -lt $argList.Count; $i++) {
  $opt = [string]$argList[$i]
  if (@('-h', '--help', '/?') -contains $opt) { Write-Host $usage; exit 0 }
  if (@('-y', '--yes') -contains $opt) { $ask = $false; continue }
  if ($opt -eq '--network') { $sets['ACCESS'] = 'network'; $ask = $false; continue }
  if (-not $optionKeys.Contains($opt)) { Fail "Unknown option $opt (see launch.cmd --help)" 2 }
  if ($i + 1 -ge $argList.Count) { Fail "$opt needs a value (see launch.cmd --help)" 2 }
  $val = [string]$argList[++$i]
  if ($choices.ContainsKey($opt) -and $choices[$opt] -notcontains $val) { Fail "$opt is one of: $($choices[$opt] -join ', ')" 2 }
  if ($opt -eq '--port' -and $val -notmatch '^\d+$') { Fail "$opt is a number" 2 }
  if ($opt -eq '--accent' -and $val -notmatch '^#[0-9a-fA-F]{6}$') { Fail '--accent is a color like #3b82f6' 2 }
  if ($opt -eq '--disable') {
    $val = $val -replace '\s', ''
    if (-not (Test-Features $val)) { Fail "--disable takes a comma separated list of: $($featureNames -join ', ')" 2 }
  }
  if ($opt -eq '--url') { $val = $val.TrimEnd('/'); $sets['ACCESS'] = 'domain' }
  $sets[$optionKeys[$opt]] = $val
  $ask = $false
}

# ---- docker ------------------------------------------------------------------

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail "Retro Board runs in Docker, which isn't installed yet.`nGet Docker Desktop for Windows: https://docs.docker.com/desktop/setup/install/windows-install/`nThen run launch.cmd again."
}

# Docker installed but not running: start Docker Desktop and wait.
if ((Invoke-Quiet { docker info }) -ne 0) {
  $exe = @("$env:ProgramFiles\Docker\Docker\Docker Desktop.exe", "$env:LOCALAPPDATA\Docker\Docker Desktop.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $exe) { Fail 'Docker is installed but not running. Start Docker Desktop and run this again.' }
  Start-Process $exe
  Write-Host -NoNewline 'Starting Docker Desktop'
  $tries = 0
  while ((Invoke-Quiet { docker info }) -ne 0) {
    if (++$tries -gt 60) { Write-Host ''; Fail "Docker didn't start within 2 minutes. Start Docker Desktop yourself and run this again." }
    Write-Host -NoNewline '.'; Start-Sleep -Seconds 2
  }
  Write-Host ''
}

# Docker Compose v2.24+ is needed for the optional .env file.
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$cv = (docker compose version --short 2>$null) -replace '^v', ''
$ErrorActionPreference = $prev
if (-not $cv) { Fail 'This needs Docker Compose v2 ("docker compose"). Update Docker Desktop.' }
$cparts = $cv.Split('.')
if ([int]$cparts[0] -lt 2 -or ([int]$cparts[0] -eq 2 -and [int]$cparts[1] -lt 24)) { Fail "Docker Compose $cv is too old (needs 2.24 or newer). Update Docker Desktop." }

# ---- backup / restore --------------------------------------------------------

function Test-Running([string]$service) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { return [bool](docker compose ps -q --status running $service 2>$null) } finally { $ErrorActionPreference = $prev }
}

function Confirm-Up {
  if (-not (Test-Running 'db') -or -not (Test-Running 'app')) {
    if ((Invoke-Quiet { docker compose up -d }) -ne 0) { Fail "Couldn't start Retro Board to read its data. Run launch.cmd first." }
    for ($t = 0; $t -lt 60; $t++) { if ((Invoke-Quiet { docker compose exec -T db pg_isready -U retro }) -eq 0) { break }; Start-Sleep -Seconds 2 }
  }
}

# Uses docker compose cp (binary-safe) and Windows' built-in tar.exe for the one-file backup. Named in full:
# another tar earlier on PATH (Git's) reads "C:\..." as a remote host.
$tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path $tarExe)) { $tarExe = 'tar' }
function Save-Backup([string]$out) {
  Confirm-Up
  New-Item -ItemType Directory -Force backups | Out-Null
  if (-not $out) { $out = "backups\retro-board-$(Get-Date -Format 'yyyy-MM-dd_HHmmss').tar.gz" }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("retro-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory $tmp | Out-Null
  # Unique names inside the containers, removed again, so runs never trip over each other's leftovers.
  $n = "rb-" + [Guid]::NewGuid().ToString('N')
  Invoke-Quiet { docker compose exec -T db sh -c "pg_dump -U retro -Fc retro > /tmp/$n.dump" } | Out-Null
  Invoke-Quiet { docker compose cp "db:/tmp/$n.dump" "$tmp\database.dump" } | Out-Null
  Invoke-Quiet { docker compose exec -T db rm -f "/tmp/$n.dump" } | Out-Null
  Invoke-Quiet { docker compose exec -T app sh -c "mkdir -p /data/uploads && cd /data && tar czf /tmp/$n.tgz uploads" } | Out-Null
  Invoke-Quiet { docker compose cp "app:/tmp/$n.tgz" "$tmp\uploads.tgz" } | Out-Null
  Invoke-Quiet { docker compose exec -T app rm -f "/tmp/$n.tgz" } | Out-Null
  if (-not (Test-Path "$tmp\database.dump")) { Remove-Item -Recurse -Force $tmp; Fail 'The backup failed: could not read the database.' }
  $full = Join-Path $PWD $out
  Invoke-Quiet { & $tarExe -czf $full -C $tmp database.dump uploads.tgz } | Out-Null
  Remove-Item -Recurse -Force $tmp
  if (-not (Test-Path $full)) { Fail "The backup failed: couldn't write $out" }
  return $out
}

function Restore-Backup([string]$file) {
  if (-not (Test-Path $file)) { Fail "No backup at $file" }
  Confirm-Up
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("retro-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory $tmp | Out-Null
  Invoke-Quiet { & $tarExe -xzf (Resolve-Path $file).Path -C $tmp } | Out-Null
  if (Test-Path "$tmp\retro-board-backup.json") {
    Remove-Item -Recurse -Force $tmp
    Fail "$file was made in the app (Admin > Customize > Your Data). Restore it there: Restore from Backup."
  }
  if (-not (Test-Path "$tmp\database.dump")) { Remove-Item -Recurse -Force $tmp; Fail "$file isn't a Retro Board backup" }
  $n = "rb-" + [Guid]::NewGuid().ToString('N')
  Invoke-Quiet { docker compose stop app } | Out-Null
  Invoke-Quiet { docker compose cp "$tmp\database.dump" "db:/tmp/$n.dump" } | Out-Null
  # A fresh, empty database first, so the backup comes back exactly as it was (and newer app versions can
  # upgrade it as usual on start).
  # (SQL goes in on stdin: Windows PowerShell mangles double quotes inside arguments to other programs.)
  $reset = "DROP DATABASE IF EXISTS retro WITH (FORCE);`nCREATE DATABASE retro OWNER retro;`n"
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $reset | docker compose exec -T db psql -q -U retro -d postgres 2>&1 | Out-Null
  $ErrorActionPreference = $prev
  Invoke-Quiet { docker compose exec -T db sh -c "pg_restore -U retro -d retro --no-owner /tmp/$n.dump" } | Out-Null
  Invoke-Quiet { docker compose exec -T db rm -f "/tmp/$n.dump" } | Out-Null
  Invoke-Quiet { docker compose start app } | Out-Null
  for ($t = 0; $t -lt 30 -and -not (Test-Running 'app'); $t++) { Start-Sleep -Seconds 1 }
  if (Test-Path "$tmp\uploads.tgz") {
    Invoke-Quiet { docker compose cp "$tmp\uploads.tgz" "app:/tmp/$n.tgz" } | Out-Null
    Invoke-Quiet { docker compose exec -T app sh -c "mkdir -p /data/uploads && rm -rf /data/uploads/* && tar xzf /tmp/$n.tgz -C /data/uploads --strip-components=1 -m --no-overwrite-dir" } | Out-Null
    Invoke-Quiet { docker compose exec -T -u root app rm -f "/tmp/$n.tgz" } | Out-Null
  }
  Remove-Item -Recurse -Force $tmp
  Invoke-Quiet { docker compose restart app } | Out-Null
}

if ($cmd -eq 'stop') { docker compose down; exit $LASTEXITCODE }
if ($cmd -eq 'logs') { docker compose logs -f app; exit $LASTEXITCODE }
if ($cmd -eq 'backup') {
  if (-not (Test-Path $envPath)) { Fail 'Nothing to back up yet: run launch.cmd first.' }
  $f = Save-Backup ''
  Write-Host "Saved everything (database and uploads) to $f"
  Write-Host "Put it back any time with: launch.cmd restore $f"
  exit 0
}
if ($cmd -eq 'restore') {
  if (-not (Test-Path $envPath)) { Fail 'Run launch.cmd once first, then restore.' }
  Write-Host "This replaces all current data with the backup in $restoreFile."
  if (-not [Console]::IsInputRedirected) {
    $a = Read-Host 'Continue? [y/N]'
    if ($a -notmatch '^(y|yes)$') { Write-Host 'Nothing changed.'; exit 0 }
  }
  Restore-Backup $restoreFile
  Write-Host "Restored from $restoreFile."
  exit 0
}

# ---- settings ----------------------------------------------------------------

$firstRun = $false
if (-not (Test-Path $envPath)) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  $text = [IO.File]::ReadAllText((Join-Path $PWD '.env.example')) -replace '(?m)^SESSION_SECRET=.*$', "SESSION_SECRET=$secret"
  [IO.File]::WriteAllText($envPath, ($text -replace "`r`n", "`n"), $utf8)
  $firstRun = $true
  Write-Host 'Created .env with a random SESSION_SECRET'
}
$oldStorage = Get-EnvValue 'DATA_STORAGE'
# Installs from before the data choice existed keep their data in Docker volumes.
if (-not $oldStorage -and -not $firstRun) { $oldStorage = 'volumes' }

foreach ($k in $sets.Keys) { Set-EnvValue $k $sets[$k] }

if ([Console]::IsInputRedirected) { $ask = $false }

function Ask([string]$question, [string]$default) {
  $answer = Read-Host "$question [$default]"
  if ($answer) { $answer } else { $default }
}

function Ask-Secret([string]$question, [string]$current) {
  $hint = if ($current) { 'set, Enter keeps it' } else { 'not set' }
  $secure = Read-Host "$question [$hint]" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if ($plain) { $plain } else { $current }
}

function Ask-YesNo([string]$question, [bool]$default) {
  $answer = Read-Host "$question [$(if ($default) { 'Y/n' } else { 'y/N' })]"
  if (-not $answer) { return $default }
  return $answer -match '^(y|yes)$'
}

function Ask-Choice([string]$question, [string]$default, [string[]]$options) {
  while ($true) {
    $picked = Ask $question $default
    if ($options -contains $picked) { return $picked }
    Write-Host "  type one of: $($options -join ', ')"
  }
}

function Ask-Provider([string]$label, [string]$idKey, [string]$secretKey, [string]$extraKey, [string]$extraQuestion, [string]$extraDefault) {
  $curId = Get-EnvValue $idKey
  $state = if ($curId) { 'on' } else { 'off' }
  if (Ask-YesNo "  $label sign-in (now $state)?" ([bool]$curId)) {
    if ($extraKey) {
      $curExtra = Get-EnvValue $extraKey
      Set-EnvValue $extraKey (Ask "    $extraQuestion" $(if ($curExtra) { $curExtra } else { $extraDefault }))
    }
    Set-EnvValue $idKey (Ask '    Client ID' $curId)
    Set-EnvValue $secretKey (Ask-Secret '    Client secret' (Get-EnvValue $secretKey))
  } elseif ($curId) {
    Set-EnvValue $idKey ''; Set-EnvValue $secretKey ''
    Write-Host "    $label turned off"
  }
}

function Or([string]$a, [string]$b) { if ($a) { $a } else { $b } }

if ($ask) {
  Write-Host ''
  Write-Host 'Retro Board setup. Press Enter to keep the value in [brackets]. (launch.cmd -y skips this.)'
  Write-Host ''
  Write-Host '1. Where should your data live? It stays on this computer either way; nothing is sent anywhere.'
  Write-Host "   folder   plain folders in $PWD\data, easy to see, copy and back up"
  Write-Host '   volumes  Docker-managed storage, out of sight'
  Set-EnvValue 'DATA_STORAGE' (Ask-Choice 'Data' (Or (Get-EnvValue 'DATA_STORAGE') (Or $oldStorage 'folder')) @('folder', 'volumes'))

  Write-Host ''
  Write-Host '2. Who will open it?'
  Write-Host '   local    just this computer'
  Write-Host '   network  people on your network (office, VPN): you get an address to send them'
  Write-Host "   domain   a real web address you've set up (https://retro.example.com)"
  $access = Ask-Choice 'Access' (Or (Get-EnvValue 'ACCESS') 'local') @('local', 'network', 'domain')
  Set-EnvValue 'ACCESS' $access
  if ($access -eq 'domain') {
    $u = Get-EnvValue 'PUBLIC_URL'
    if ($u -match '^http://(localhost|\d)') { $u = '' }
    Set-EnvValue 'PUBLIC_URL' ((Ask '   Address people open' $u).TrimEnd('/'))
  }
  Set-EnvValue 'PORT' (Ask '   Port' (Or (Get-EnvValue 'PORT') '8080'))

  Write-Host ''
  Write-Host '3. How do people get in?'
  Write-Host '   accounts  sign in with email/password or Google, GitHub, Microsoft, Okta'
  Write-Host '   none      no sign-in: anyone who can open the site can do everything,'
  Write-Host '             and is asked for a name when they first add a card (trusted networks only)'
  $mode = Ask-Choice 'Sign-in' (Or (Get-EnvValue 'AUTH_MODE') 'accounts') @('accounts', 'none')
  Set-EnvValue 'AUTH_MODE' $mode
  if ($mode -eq 'accounts') {
    Write-Host '   Who can create an email/password account? open (anyone), invite (team invite link only), closed'
    Set-EnvValue 'LOCAL_SIGNUP' (Ask-Choice '   Sign-up' (Or (Get-EnvValue 'LOCAL_SIGNUP') 'open') @('open', 'invite', 'closed'))
    Set-EnvValue 'ADMIN_EMAILS' (Ask '   Admin emails, comma separated (the first account is always admin)' (Get-EnvValue 'ADMIN_EMAILS'))
    if (Ask-YesNo '   Set up Google, GitHub, Microsoft or Okta sign-in now? (steps in docs\auth.md)' $false) {
      Ask-Provider 'Google' 'GOOGLE_CLIENT_ID' 'GOOGLE_CLIENT_SECRET'
      Ask-Provider 'GitHub' 'GITHUB_CLIENT_ID' 'GITHUB_CLIENT_SECRET'
      Ask-Provider 'Microsoft' 'MS_CLIENT_ID' 'MS_CLIENT_SECRET' 'MS_TENANT' 'Tenant (common = any Microsoft account)' 'common'
      Ask-Provider 'Okta' 'OKTA_CLIENT_ID' 'OKTA_CLIENT_SECRET' 'OKTA_ISSUER' 'Issuer, e.g. https://your-org.okta.com' ''
    }
  }

  Write-Host ''
  Write-Host '4. Look and defaults. Admins can change all of this later in the app (Admin > Customize).'
  if (Ask-YesNo '   Customize now?' $false) {
    Set-EnvValue 'SITE_NAME' (Ask '   Site name' (Or (Get-EnvValue 'SITE_NAME') 'Retro Board'))
    Set-EnvValue 'DEFAULT_THEME' (Ask-Choice '   Theme (auto = light/dark per device; light, dark, midnight, forest, sunset, grape, high-contrast)' (Or (Get-EnvValue 'DEFAULT_THEME') 'auto') $choices['--theme'])
    while ($true) {
      $accent = Ask "   Accent color, like #3b82f6 (Enter for the theme's own)" (Get-EnvValue 'DEFAULT_ACCENT')
      if (-not $accent -or $accent -match '^#[0-9a-fA-F]{6}$') { break }
      Write-Host '   use # and six hex digits'
    }
    Set-EnvValue 'DEFAULT_ACCENT' $accent
    Write-Host '   Columns for new boards: went-well (Went well / To improve / Action ideas), start-stop-continue,'
    Write-Host '   mad-sad-glad, 4ls (Liked / Learned / Lacked / Longed for), sailboat, blank'
    Set-EnvValue 'DEFAULT_TEMPLATE' (Ask-Choice '   Columns' (Or (Get-EnvValue 'DEFAULT_TEMPLATE') 'went-well') $choices['--columns'])
    Write-Host "   Features you can switch off for everyone: $($featureNames -join ', ')"
    while ($true) {
      $off = (Ask '   Switch off (comma separated, Enter for none)' (Get-EnvValue 'DISABLED_FEATURES')) -replace '\s', ''
      if (Test-Features $off) { break }
      Write-Host '   use names from the list, separated by commas'
    }
    Set-EnvValue 'DISABLED_FEATURES' $off
  }

  Write-Host ''
  Write-Host '5. GIF search (optional): a Giphy or Tenor API key turns on the GIF button. Enter to skip either'
  Set-EnvValue 'GIPHY_API_KEY' (Ask-Secret '   Giphy API key (searches go to Giphy; used if both are set)' (Get-EnvValue 'GIPHY_API_KEY'))
  Set-EnvValue 'TENOR_API_KEY' (Ask-Secret '   Tenor API key (searches go to Tenor)' (Get-EnvValue 'TENOR_API_KEY'))
  Write-Host ''
}

# ---- where the data lives ----------------------------------------------------

$storage = Get-EnvValue 'DATA_STORAGE'
if (-not $storage) { $storage = Or $oldStorage 'folder'; Set-EnvValue 'DATA_STORAGE' $storage }

# Switching storage with data already in the old place: carry it across with a backup and restore.
$moving = ''
if ($oldStorage -and $oldStorage -ne $storage -and (Test-Running 'db')) {
  Write-Host "Moving your data from $oldStorage to $storage storage..."
  $moving = Save-Backup "backups\before-move-to-$storage-$(Get-Date -Format 'yyyy-MM-dd_HHmmss').tar.gz"
  Write-Host "  Saved a copy to $moving (the old $oldStorage storage is left as it was)"
  Invoke-Quiet { docker compose down } | Out-Null
}
if ($storage -eq 'folder') {
  New-Item -ItemType Directory -Force 'data\postgres', 'data\uploads' | Out-Null
  Set-EnvValue 'DB_MOUNT' './data/postgres:/var/lib/postgresql/data'
  Set-EnvValue 'UPLOADS_MOUNT' './data/uploads:/data/uploads'
  Set-EnvValue 'DATA_LOCATION' "$PWD\data on this computer"
} else {
  Set-EnvValue 'DATA_LOCATION' 'Docker volumes retro-board_db and retro-board_uploads on this computer'
  Set-EnvValue 'DB_MOUNT' 'db:/var/lib/postgresql/data'
  Set-EnvValue 'UPLOADS_MOUNT' 'uploads:/data'
}

# ---- address -----------------------------------------------------------------

function Resolve-Address {
  $script:port = Or (Get-EnvValue 'PORT') '8080'
  $script:url = Get-EnvValue 'PUBLIC_URL'
  $script:access = Get-EnvValue 'ACCESS'
  if (-not $script:access) {
    # .env from before ACCESS existed: work it out from the address
    $script:access = if (-not $script:url -or $script:url -like 'http://localhost:*') { 'local' } elseif ($script:url -match '^http://(10|192\.168|172)\.') { 'network' } else { 'domain' }
    Set-EnvValue 'ACCESS' $script:access
  }
  switch ($script:access) {
    'local' { $script:url = "http://localhost:$($script:port)" }
    'network' {
      $ip = Get-LanIp
      if ($ip) {
        $new = "http://${ip}:$($script:port)"
        if ($script:url -and $script:url -ne $new -and $script:url -notlike 'http://localhost:*') { Write-Host "Network address changed: $($script:url) -> $new" }
        $script:url = $new
      } else {
        if (-not $script:url) { $script:url = "http://localhost:$($script:port)" }
        Write-Host "Couldn't find this computer's network address; keeping $($script:url)."
        Write-Host "Set it yourself with launch.cmd --url http://<ip>:$($script:port)"
      }
    }
    default { if (-not $script:url) { $script:url = "http://localhost:$($script:port)" } }
  }
  Set-EnvValue 'PUBLIC_URL' $script:url
}
Resolve-Address
$mode = Get-EnvValue 'AUTH_MODE'

# Windows Firewall: let other computers reach the port.
$firewallOk = $true
if ($access -eq 'network') {
  $ruleName = "Retro Board ($port)"
  if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    $firewallOk = $false
    $addRule = "New-NetFirewallRule -DisplayName '$ruleName' -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Private,Domain"
    if (-not [Console]::IsInputRedirected -and (Ask-YesNo "Allow port $port through Windows Firewall so others can connect? (asks for admin)" $true)) {
      try {
        Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-Command', $addRule
        $firewallOk = [bool](Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)
      } catch { Write-Host '  Skipped (admin permission was not given).' }
    }
    if (-not $firewallOk) {
      Write-Host '  To allow it later, run this in an admin PowerShell:'
      Write-Host "  $addRule"
    }
  }
}

# ---- start -------------------------------------------------------------------

while ($true) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $upOut = docker compose up -d --build 2>&1 | ForEach-Object { "$_" }
  $upCode = $LASTEXITCODE
  $ErrorActionPreference = $prev
  $upOut | Write-Host
  if ($upCode -eq 0) { break }
  if (($upOut -join "`n") -match 'port is already allocated|address already in use|ports are not available|bind: An attempt was made') {
    Write-Host ''
    Write-Host "Port $port is already used by another program on this computer."
    if (-not [Console]::IsInputRedirected) {
      Set-EnvValue 'PORT' (Ask 'Pick another port' ([string]([int]$port + 1)))
      Resolve-Address
      continue
    }
    Write-Host "Run it on another port with: launch.cmd --port $([int]$port + 1)"
  }
  exit 1
}

Write-Host -NoNewline 'Waiting for Retro Board to start (the first start takes a minute or two)'
$tries = 0
while ((Invoke-Quiet { docker compose exec -T app node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" }) -ne 0) {
  if (++$tries -gt 120) {
    Write-Host ''; Write-Host 'It did not come up. Recent logs:'
    docker compose logs --tail 40 app
    exit 1
  }
  Write-Host -NoNewline '.'
  Start-Sleep -Seconds 2
}
Write-Host ''

if ($moving) {
  Restore-Backup $moving
  Write-Host "Moved your data to $storage storage."
}

Write-Host ''
Write-Host "Retro Board is running at $url"
Write-Host ''
if ($storage -eq 'folder') { Write-Host "Your data stays on this computer, in $PWD\data" }
else { Write-Host 'Your data stays on this computer, in Docker volumes (retro-board_db, retro-board_uploads)' }
Write-Host '  Back it up any time with: launch.cmd backup'
if ($access -eq 'network') {
  Write-Host ''
  Write-Host "Send people this address: $url"
  Write-Host '  They need to be on the same network. This computer has to stay on with Docker running.'
  if (-not $firewallOk) { Write-Host "  Windows Firewall may block them until port $port is allowed (see above)." }
  Write-Host '  If Windows has this network set to Public, switch it to Private so the firewall rule applies.'
}
Write-Host ''
if ($mode -eq 'none') {
  Write-Host 'No sign-in: anyone who can open that address can see and change everything.'
} else {
  Write-Host 'The first account you create becomes the admin. Customize the look and defaults in Admin > Customize.'
  foreach ($p in @(@('google', 'GOOGLE_CLIENT_ID'), @('github', 'GITHUB_CLIENT_ID'), @('microsoft', 'MS_CLIENT_ID'), @('okta', 'OKTA_CLIENT_ID'))) {
    if (Get-EnvValue $p[1]) { Write-Host "  $($p[0]) redirect URL: $url/api/auth/$($p[0])/callback" }
  }
  if ($access -eq 'network' -and ((Get-EnvValue 'GOOGLE_CLIENT_ID') + (Get-EnvValue 'MS_CLIENT_ID') + (Get-EnvValue 'OKTA_CLIENT_ID'))) {
    Write-Host "  Note: Google, Microsoft and Okta won't redirect back to a plain network IP address."
    Write-Host '  On a network, use email/password, GitHub, or no sign-in (--auth none).'
  }
}
Start-Process $url
