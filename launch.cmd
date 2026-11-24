@echo off
rem One command to run Retro Board on Windows: launch.cmd   (also: launch.cmd stop | logs | update)
setlocal enabledelayedexpansion
cd /d "%~dp0"

where docker >nul 2>nul || (echo Docker is not installed. Get it from https://docs.docker.com/get-docker/ & exit /b 1)
docker info >nul 2>nul || (echo Docker is installed but not running. Start Docker Desktop and try again. & exit /b 1)

if "%1"=="stop" (docker compose down & exit /b 0)
if "%1"=="logs" (docker compose logs -f app & exit /b 0)

if not exist .env (
  for /f "delims=" %%s in ('powershell -NoProfile -Command "-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })"') do set SECRET=%%s
  powershell -NoProfile -Command "(Get-Content .env.example) -replace '^SESSION_SECRET=.*', 'SESSION_SECRET=!SECRET!' | Set-Content .env"
  echo Created .env with a random SESSION_SECRET
)

set URL=http://localhost:8080
for /f "tokens=1,* delims==" %%a in ('findstr /b "PUBLIC_URL=" .env') do if not "%%b"=="" set URL=%%b

docker compose up -d --build || exit /b 1

echo Waiting for Retro Board to start...
set /a TRIES=0
:wait
docker compose exec -T app node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >nul 2>nul && goto up
set /a TRIES+=1
if !TRIES! gtr 90 (
  echo It did not come up. Recent logs:
  docker compose logs --tail 40 app
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto wait

:up
echo Retro Board is running at %URL%
echo The first account you create becomes the admin.
start "" "%URL%"
