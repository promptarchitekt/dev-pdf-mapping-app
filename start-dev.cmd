@echo off
setlocal ENABLEDELAYEDEXPANSION
rem Start script for PDF-Mapping-App (Windows CMD)
cd /d "%~dp0"

if not exist node_modules (
  echo [setup] Installing dependencies...
  call npm install
)

for /f "usebackq delims=" %%P in (`powershell -NoLogo -NoProfile -Command "
  function Get-FreePort([int]$start=3007,[int]$end=3099){
    for($p=$start;$p -le $end;$p++){
      try{ $l = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$p); $l.Start(); $l.Stop(); return $p }catch{}
    }
    throw 'no free port'
  }
  Get-FreePort 3007 3099
"`) do set PORT=%%P

echo [dev] Starting Next.js on http://localhost:%PORT%
start "" http://localhost:%PORT%/
set PORT=%PORT%
call npm run dev
