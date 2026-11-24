@echo off
rem One command to run Retro Board on Windows: launch.cmd   (launch.cmd --help for options)
rem The work happens in launch.ps1; this wrapper lets it run without changing PowerShell's execution policy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" %*
exit /b %ERRORLEVEL%
