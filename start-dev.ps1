<#
  Start script for PDF-Mapping-App (PowerShell)
  - Installs dependencies on first run
  - Opens browser and starts Next.js dev server on port 3007
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Set-Location -Path $PSScriptRoot

function Get-FreePort([int]$start = 3007, [int]$end = 3099) {
  for ($p = $start; $p -le $end; $p++) {
    try {
      $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p)
      $listener.Start()
      $listener.Stop()
      return $p
    } catch {
      continue
    }
  }
  throw "No free port in range $start..$end"
}

if (-not (Test-Path node_modules)) {
  Write-Host "[setup] Installing dependencies..." -ForegroundColor Cyan
  npm install | Out-Host
}

$port = Get-FreePort 3007 3099
$env:PORT = $port
Write-Host "[dev] Starting Next.js on http://localhost:$port" -ForegroundColor Green
Start-Process "http://localhost:$port"
npm run dev | Out-Host
Write-Host "`n[info] Dev server exited. Press Enter to close." -ForegroundColor Yellow
Read-Host > $null
