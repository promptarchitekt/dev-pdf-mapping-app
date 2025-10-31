@echo off
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION
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

set URL=http://localhost:%PORT%/
echo [dev] Starting Next.js on %URL%
set PORT=%PORT%

rem Try to open browser (multi-fallback)
start "" %URL% >NUL 2>&1
if errorlevel 1 powershell -NoLogo -NoProfile -Command "Start-Process '%URL%'" >NUL 2>&1
if errorlevel 1 mshta vbscript:Execute("CreateObject(""WScript.Shell"").Run(""%URL%"",1):close")

call npm run dev
echo.
echo [info] Dev server exited. Press any key to close.
pause >NUL
