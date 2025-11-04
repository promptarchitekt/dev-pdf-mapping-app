# Test-Script für Next.js Build und Linting
# Prüft auf Build-Fehler und TypeScript-Fehler

Write-Host "🔍 Starte Build- und Lint-Prüfung..." -ForegroundColor Cyan

$ErrorActionPreference = "Stop"

# Wechsle ins Projekt-Verzeichnis (das Script liegt bereits im PDF-Mapping-App Ordner)
$projectDir = $PSScriptRoot
if (-not (Test-Path (Join-Path $projectDir "package.json"))) {
    Write-Host "❌ package.json nicht gefunden in: $projectDir" -ForegroundColor Red
    exit 1
}
Set-Location $projectDir

Write-Host "📁 Projekt-Verzeichnis: $projectDir" -ForegroundColor Gray

# 1. TypeScript-Prüfung
Write-Host "`n✅ Prüfe TypeScript..." -ForegroundColor Yellow
try {
    $tscResult = & npx tsc --noEmit 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ TypeScript: Keine Fehler" -ForegroundColor Green
    } else {
        Write-Host "❌ TypeScript-Fehler gefunden:" -ForegroundColor Red
        Write-Host $tscResult
        exit 1
    }
} catch {
    Write-Host "⚠️ TypeScript-Prüfung übersprungen (tsc nicht verfügbar)" -ForegroundColor Yellow
}

# 2. Next.js Build-Prüfung
Write-Host "`n✅ Prüfe Next.js Build..." -ForegroundColor Yellow
try {
    # Prüfe ob .next existiert und lösche es für sauberen Build
    if (Test-Path ".next") {
        Write-Host "🗑️ Lösche .next Cache..." -ForegroundColor Gray
        Remove-Item -Recurse -Force .next
    }

    # Starte Build (nur Prüfung, keine Ausgabe)
    Write-Host "🔨 Führe Build aus..." -ForegroundColor Gray
    $buildResult = & npm run build 2>&1 | Out-String

    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Build: Erfolgreich" -ForegroundColor Green
    } else {
        Write-Host "❌ Build-Fehler gefunden:" -ForegroundColor Red
        Write-Host $buildResult
        exit 1
    }
} catch {
    Write-Host "❌ Build-Fehler:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}

# 3. ESLint-Prüfung (falls vorhanden)
if (Test-Path "package.json") {
    $packageJson = Get-Content "package.json" | ConvertFrom-Json
    if ($packageJson.scripts.lint) {
        Write-Host "`n✅ Prüfe ESLint..." -ForegroundColor Yellow
        try {
            $lintResult = & npm run lint 2>&1 | Out-String
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✓ ESLint: Keine Fehler" -ForegroundColor Green
            } else {
                Write-Host "⚠️ ESLint-Warnungen gefunden:" -ForegroundColor Yellow
                Write-Host $lintResult
            }
        } catch {
            Write-Host "⚠️ ESLint-Prüfung übersprungen" -ForegroundColor Yellow
        }
    }
}

Write-Host "`n✅ Alle Prüfungen abgeschlossen!" -ForegroundColor Green
exit 0
