# One command to run Retro Board on Windows. Use launch.cmd (it runs this file); same options as launch.sh.
#
#   launch.cmd                 asks how to set it up (current values are the defaults), then builds and starts
#   launch.cmd [options]       sets what you pass, no questions, then builds and starts
#   launch.cmd -y              starts with the current settings, no questions
#   launch.cmd --network       share it on your network (prints the address to give people)
#   launch.cmd update | stop | logs
#
# launch.cmd --help lists the options.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$usage = @'
Usage: launch.cmd [up|update|stop|logs] [options]

With no options, launch.cmd asks each question below, showing the current value; press Enter to keep it.
Passing any option (or -y) skips the questions. Everything is saved in .env.

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
'@

# ---- .env helpers ------------------------------------------------------------

$utf8 = New-Object System.Text.UTF8Encoding $false

function Read-EnvLines { if (Test-Path .env) { [IO.File]::ReadAllLines((Join-Path $PWD '.env')) } else { @() } }

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
  [IO.File]::WriteAllText((Join-Path $PWD '.env'), (($lines -join "`n") + "`n"), $utf8)
}

# ---- arguments ---------------------------------------------------------------

$argList = @($args)
$cmd = 'up'
if ($argList.Count -gt 0 -and @('up', 'update', 'stop', 'logs') -contains $argList[0]) {
  $cmd = $argList[0]
  $argList = @($argList | Select-Object -Skip 1)
}
$ask = $cmd -eq 'up'

$optionKeys = [ordered]@{
  '--admin-emails' = 'ADMIN_EMAILS'
  '--google-id' = 'GOOGLE_CLIENT_ID'; '--google-secret' = 'GOOGLE_CLIENT_SECRET'
  '--github-id' = 'GITHUB_CLIENT_ID'; '--github-secret' = 'GITHUB_CLIENT_SECRET'
  '--ms-id' = 'MS_CLIENT_ID'; '--ms-secret' = 'MS_CLIENT_SECRET'; '--ms-tenant' = 'MS_TENANT'
  '--okta-issuer' = 'OKTA_ISSUER'; '--okta-id' = 'OKTA_CLIENT_ID'; '--okta-secret' = 'OKTA_CLIENT_SECRET'
  '--port' = 'PORT'; '--url' = 'PUBLIC_URL'; '--tenor-key' = 'TENOR_API_KEY'
  '--auth' = 'AUTH_MODE'; '--signup' = 'LOCAL_SIGNUP'; '--access' = 'ACCESS'
}
$sets = [ordered]@{}

for ($i = 0; $i -lt $argList.Count; $i++) {
  $opt = [string]$argList[$i]
  if (@('-h', '--help', '/?') -contains $opt) { Write-Host $usage; exit 0 }
  if (@('-y', '--yes') -contains $opt) { $ask = $false; continue }
  if ($opt -eq '--network') { $sets['ACCESS'] = 'network'; $ask = $false; continue }
  if (-not $optionKeys.Contains($opt)) { [Console]::Error.WriteLine("Unknown option $opt (see launch.cmd --help)"); exit 2 }
  if ($i + 1 -ge $argList.Count) { [Console]::Error.WriteLine("$opt needs a value (see launch.cmd --help)"); exit 2 }
  $val = [string]$argList[++$i]
  if ($opt -eq '--auth' -and @('accounts', 'none') -notcontains $val) { [Console]::Error.WriteLine('--auth is accounts or none'); exit 2 }
  if ($opt -eq '--signup' -and @('open', 'invite', 'closed') -notcontains $val) { [Console]::Error.WriteLine('--signup is open, invite or closed'); exit 2 }
  if ($opt -eq '--access' -and @('local', 'network', 'domain') -notcontains $val) { [Console]::Error.WriteLine('--access is local, network or domain'); exit 2 }
  if ($opt -eq '--url') { $val = $val.TrimEnd('/'); $sets['ACCESS'] = 'domain' }
  $sets[$optionKeys[$opt]] = $val
  $ask = $false
}

# ---- docker ------------------------------------------------------------------

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host 'Docker is not installed. Get it from https://docs.docker.com/get-docker/'; exit 1
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { Write-Host 'Docker is installed but not running. Start Docker Desktop and try again.'; exit 1 }

if ($cmd -eq 'stop') { docker compose down; exit $LASTEXITCODE }
if ($cmd -eq 'logs') { docker compose logs -f app; exit $LASTEXITCODE }

# ---- settings ----------------------------------------------------------------

if (-not (Test-Path .env)) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  $text = [IO.File]::ReadAllText((Join-Path $PWD '.env.example')) -replace '(?m)^SESSION_SECRET=.*$', "SESSION_SECRET=$secret"
  [IO.File]::WriteAllText((Join-Path $PWD '.env'), ($text -replace "`r`n", "`n"), $utf8)
  Write-Host 'Created .env with a random SESSION_SECRET'
}

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

function Ask-Choice([string]$question, [string]$default, [string[]]$choices) {
  while ($true) {
    $picked = Ask $question $default
    if ($choices -contains $picked) { return $picked }
    Write-Host "  type $($choices -join ', ')"
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

if ($ask) {
  Write-Host ''
  Write-Host 'Retro Board setup. Press Enter to keep the value in [brackets]. (launch.cmd -y skips this.)'
  Write-Host ''
  Write-Host 'How do people get in?'
  Write-Host '  accounts  sign in with email/password or Google, GitHub, Microsoft, Okta'
  Write-Host '  none      no sign-in: anyone who can open the site can do everything,'
  Write-Host '            and is asked for a name when they first add a card'
  $mode = Get-EnvValue 'AUTH_MODE'; if (-not $mode) { $mode = 'accounts' }
  $mode = Ask-Choice 'Sign-in' $mode @('accounts', 'none')
  Set-EnvValue 'AUTH_MODE' $mode

  if ($mode -eq 'accounts') {
    Write-Host ''
    Write-Host 'Who can create an email/password account? open (anyone), invite (team invite link only), closed'
    $signup = Get-EnvValue 'LOCAL_SIGNUP'; if (-not $signup) { $signup = 'open' }
    Set-EnvValue 'LOCAL_SIGNUP' (Ask-Choice 'Sign-up' $signup @('open', 'invite', 'closed'))
    Set-EnvValue 'ADMIN_EMAILS' (Ask 'Admin emails, comma separated (the first account is always admin)' (Get-EnvValue 'ADMIN_EMAILS'))

    Write-Host ''
    Write-Host 'Sign-in providers. Setup steps for each are in docs\auth.md.'
    Ask-Provider 'Google' 'GOOGLE_CLIENT_ID' 'GOOGLE_CLIENT_SECRET'
    Ask-Provider 'GitHub' 'GITHUB_CLIENT_ID' 'GITHUB_CLIENT_SECRET'
    Ask-Provider 'Microsoft' 'MS_CLIENT_ID' 'MS_CLIENT_SECRET' 'MS_TENANT' 'Tenant (common = any Microsoft account)' 'common'
    Ask-Provider 'Okta' 'OKTA_CLIENT_ID' 'OKTA_CLIENT_SECRET' 'OKTA_ISSUER' 'Issuer, e.g. https://your-org.okta.com' ''
  }

  Write-Host ''
  $port = Get-EnvValue 'PORT'; if (-not $port) { $port = '8080' }
  $port = Ask 'Port' $port
  Set-EnvValue 'PORT' $port
  Write-Host ''
  Write-Host 'Who will open it?'
  Write-Host '  local    just this computer'
  Write-Host '  network  people on your network (office, VPN): you get an address to send them'
  Write-Host "  domain   a real web address you've set up (https://retro.example.com)"
  $access = Get-EnvValue 'ACCESS'; if (-not $access) { $access = 'local' }
  $access = Ask-Choice 'Access' $access @('local', 'network', 'domain')
  Set-EnvValue 'ACCESS' $access
  if ($access -eq 'domain') {
    $url = Get-EnvValue 'PUBLIC_URL'
    if ($url -match '^http://(localhost|\d)') { $url = '' }
    Set-EnvValue 'PUBLIC_URL' ((Ask 'Address people open' $url).TrimEnd('/'))
  }
  Set-EnvValue 'TENOR_API_KEY' (Ask-Secret 'Tenor API key for GIF search (optional)' (Get-EnvValue 'TENOR_API_KEY'))
  Write-Host ''
}

# ---- address -----------------------------------------------------------------

# This computer's address on the local network (the adapter with the default route), or nothing.
function Get-LanIp {
  try {
    $cfg = Get-NetIPConfiguration -ErrorAction Stop |
      Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
    if ($cfg) { return @($cfg.IPv4Address)[0].IPAddress }
  } catch {}
  return ''
}

$port = Get-EnvValue 'PORT'; if (-not $port) { $port = '8080' }
$url = Get-EnvValue 'PUBLIC_URL'
$access = Get-EnvValue 'ACCESS'
if (-not $access) {
  # .env from before ACCESS existed: work it out from the address
  $access = if (-not $url -or $url -like 'http://localhost:*') { 'local' } elseif ($url -match '^http://(10|192\.168|172)\.') { 'network' } else { 'domain' }
  Set-EnvValue 'ACCESS' $access
}
switch ($access) {
  'local' { $url = "http://localhost:$port" }
  'network' {
    $ip = Get-LanIp
    if ($ip) {
      $new = "http://${ip}:$port"
      if ($url -and $url -ne $new -and $url -notlike 'http://localhost:*') { Write-Host "Network address changed: $url -> $new" }
      $url = $new
    } else {
      if (-not $url) { $url = "http://localhost:$port" }
      Write-Host "Couldn't find this computer's network address; keeping $url."
      Write-Host "Set it yourself with launch.cmd --url http://<ip>:$port"
    }
  }
  default { if (-not $url) { $url = "http://localhost:$port" } }
}
Set-EnvValue 'PUBLIC_URL' $url
$mode = Get-EnvValue 'AUTH_MODE'

# Windows Firewall: let other computers reach the port.
$ruleName = "Retro Board ($port)"
$firewallOk = $true
if ($access -eq 'network') {
  $rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if (-not $rule) {
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

docker compose up -d --build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host -NoNewline 'Waiting for Retro Board to start'
$tries = 0
while ($true) {
  docker compose exec -T app node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" *> $null
  if ($LASTEXITCODE -eq 0) { break }
  if (++$tries -gt 90) {
    Write-Host ''; Write-Host 'It did not come up. Recent logs:'
    docker compose logs --tail 40 app
    exit 1
  }
  Write-Host -NoNewline '.'
  Start-Sleep -Seconds 2
}
Write-Host ''
Write-Host "Retro Board is running at $url"
if ($access -eq 'network') {
  Write-Host ''
  Write-Host "  Send people this address: $url"
  Write-Host '  They need to be on the same network. This computer has to stay on with Docker running.'
  if (-not $firewallOk) { Write-Host "  Windows Firewall may block them until port $port is allowed (see above)." }
  Write-Host '  If Windows has this network set to Public, switch it to Private so the firewall rule applies.'
  Write-Host ''
}
if ($mode -eq 'none') {
  Write-Host 'No sign-in: anyone who can open that address can see and change everything.'
} else {
  Write-Host 'The first account you create becomes the admin.'
  foreach ($p in @(@('google', 'GOOGLE_CLIENT_ID'), @('github', 'GITHUB_CLIENT_ID'), @('microsoft', 'MS_CLIENT_ID'), @('okta', 'OKTA_CLIENT_ID'))) {
    if (Get-EnvValue $p[1]) { Write-Host "  $($p[0]) redirect URL: $url/api/auth/$($p[0])/callback" }
  }
  if ($access -eq 'network' -and ((Get-EnvValue 'GOOGLE_CLIENT_ID') + (Get-EnvValue 'MS_CLIENT_ID') + (Get-EnvValue 'OKTA_CLIENT_ID'))) {
    Write-Host "  Note: Google, Microsoft and Okta won't redirect back to a plain network IP address."
    Write-Host '  On a network, use email/password, GitHub, or no sign-in (--auth none).'
  }
}
Start-Process $url
