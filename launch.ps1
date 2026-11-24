# One command to run Retro Board on Windows. Use launch.cmd (it runs this file); same options as launch.sh.
#
#   launch.cmd                 asks how to set it up (current values are the defaults), then builds and starts
#   launch.cmd [options]       sets what you pass, no questions, then builds and starts
#   launch.cmd -y              starts with the current settings, no questions
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

Server
  --port N                  port on this machine (default 8080)
  --url URL                 address people open, e.g. https://retro.example.com
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
  '--auth' = 'AUTH_MODE'; '--signup' = 'LOCAL_SIGNUP'
}
$sets = [ordered]@{}

for ($i = 0; $i -lt $argList.Count; $i++) {
  $opt = [string]$argList[$i]
  if (@('-h', '--help', '/?') -contains $opt) { Write-Host $usage; exit 0 }
  if (@('-y', '--yes') -contains $opt) { $ask = $false; continue }
  if (-not $optionKeys.Contains($opt)) { [Console]::Error.WriteLine("Unknown option $opt (see launch.cmd --help)"); exit 2 }
  if ($i + 1 -ge $argList.Count) { [Console]::Error.WriteLine("$opt needs a value (see launch.cmd --help)"); exit 2 }
  $val = [string]$argList[++$i]
  if ($opt -eq '--auth' -and @('accounts', 'none') -notcontains $val) { [Console]::Error.WriteLine('--auth is accounts or none'); exit 2 }
  if ($opt -eq '--signup' -and @('open', 'invite', 'closed') -notcontains $val) { [Console]::Error.WriteLine('--signup is open, invite or closed'); exit 2 }
  if ($opt -eq '--url') { $val = $val.TrimEnd('/') }
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
# a new --port also moves a localhost address, unless --url was given
if ($sets.Contains('PORT') -and -not $sets.Contains('PUBLIC_URL')) {
  $current = Get-EnvValue 'PUBLIC_URL'
  if (-not $current -or $current -like 'http://localhost:*') { Set-EnvValue 'PUBLIC_URL' "http://localhost:$($sets['PORT'])" }
}

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
  $url = Get-EnvValue 'PUBLIC_URL'
  if (-not $url -or $url -like 'http://localhost:*') { $url = "http://localhost:$port" }
  Set-EnvValue 'PUBLIC_URL' ((Ask 'Address people open' $url).TrimEnd('/'))
  Set-EnvValue 'TENOR_API_KEY' (Ask-Secret 'Tenor API key for GIF search (optional)' (Get-EnvValue 'TENOR_API_KEY'))
  Write-Host ''
}

$port = Get-EnvValue 'PORT'; if (-not $port) { $port = '8080' }
$url = Get-EnvValue 'PUBLIC_URL'; if (-not $url) { $url = "http://localhost:$port" }
$mode = Get-EnvValue 'AUTH_MODE'

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
if ($mode -eq 'none') {
  Write-Host 'No sign-in: anyone who can open that address can see and change everything.'
} else {
  Write-Host 'The first account you create becomes the admin.'
  foreach ($p in @(@('google', 'GOOGLE_CLIENT_ID'), @('github', 'GITHUB_CLIENT_ID'), @('microsoft', 'MS_CLIENT_ID'), @('okta', 'OKTA_CLIENT_ID'))) {
    if (Get-EnvValue $p[1]) { Write-Host "  $($p[0]) redirect URL: $url/api/auth/$($p[0])/callback" }
  }
}
Start-Process $url
