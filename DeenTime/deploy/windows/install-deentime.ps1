#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Install or update IqamaTime (DeenTime) as a Windows service on this PC.

.DESCRIPTION
  Run from the unzipped release folder (the one containing app\DeenTime.Api.exe)
  in an elevated PowerShell:

      Set-ExecutionPolicy -Scope Process Bypass -Force
      .\install-deentime.ps1

  First run: prompts for the database password, super-user email/password and
  the public URL, writes C:\DeenTime\app\appsettings.Production.json, creates
  the PostgreSQL role/database, and registers the "DeenTime" service.
  Later runs: keep the existing settings file and just swap in the new build.

.PARAMETER InstallDir   Where the app lives. Default C:\DeenTime
.PARAMETER PublicUrl    Public origin (e.g. https://xxxx.ngrok-free.app). Default http://localhost:8080
.PARAMETER PgBin        PostgreSQL bin folder (auto-detected under C:\Program Files\PostgreSQL)
#>
[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\DeenTime',
  [string]$PublicUrl  = '',
  [string]$PgBin      = ''
)
$ErrorActionPreference = 'Stop'
$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$src     = Join-Path $here 'app'
$appDir  = Join-Path $InstallDir 'app'
$dataDir = Join-Path $InstallDir 'data'
$logDir  = Join-Path $InstallDir 'logs'
$settings = Join-Path $appDir 'appsettings.Production.json'
$service = 'DeenTime'

if (-not (Test-Path (Join-Path $src 'DeenTime.Api.exe'))) {
  throw "app\DeenTime.Api.exe not found next to this script. Unzip the release first."
}

# ── PostgreSQL ───────────────────────────────────────────────────────────────
if (-not $PgBin) {
  $PgBin = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
           Sort-Object Name -Descending | Select-Object -First 1 | ForEach-Object { Join-Path $_.FullName 'bin' }
}
if (-not $PgBin -or -not (Test-Path (Join-Path $PgBin 'psql.exe'))) {
  throw "PostgreSQL not found. Install it first:  winget install PostgreSQL.PostgreSQL.16   (remember the postgres password)"
}
$pgService = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgService -and $pgService.Status -ne 'Running') { Start-Service $pgService.Name }

# ── Settings (first run only) ────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $appDir, $dataDir, $logDir | Out-Null
$firstRun = -not (Test-Path $settings)
if ($firstRun) {
  Write-Host "`nFirst-time setup" -ForegroundColor Cyan
  $pgAdminPw   = Read-Host -Prompt 'Password of the PostgreSQL "postgres" superuser (set during install)' -AsSecureString
  $dbPassword  = [Convert]::ToBase64String((1..24 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]]) -replace '[^A-Za-z0-9]', ''
  $suEmail     = Read-Host -Prompt 'Super-user (site admin) email'
  $suPassword  = Read-Host -Prompt 'Super-user password'
  if (-not $PublicUrl) { $PublicUrl = Read-Host -Prompt 'Public URL (press Enter for http://localhost:8080)' }
  if (-not $PublicUrl) { $PublicUrl = 'http://localhost:8080' }
  $signingKey  = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })

  # Create role + database using the postgres superuser.
  $plainAdminPw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgAdminPw))
  $env:PGPASSWORD = $plainAdminPw
  $psql = Join-Path $PgBin 'psql.exe'
  $roleExists = & $psql -h 127.0.0.1 -U postgres -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='deentime'"
  if ($roleExists -ne '1') { & $psql -h 127.0.0.1 -U postgres -d postgres -qc "CREATE ROLE deentime LOGIN PASSWORD '$dbPassword'" }
  else { & $psql -h 127.0.0.1 -U postgres -d postgres -qc "ALTER ROLE deentime WITH LOGIN PASSWORD '$dbPassword'" }
  $dbExists = & $psql -h 127.0.0.1 -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='deentime'"
  if ($dbExists -ne '1') { & $psql -h 127.0.0.1 -U postgres -d postgres -qc "CREATE DATABASE deentime OWNER deentime" }
  Remove-Item Env:PGPASSWORD

  $template = Get-Content (Join-Path $here 'appsettings.Production.template.json') -Raw
  $json = $template.Replace('__DB_PASSWORD__', $dbPassword).
                    Replace('__SIGNING_KEY__', $signingKey).
                    Replace('__PUBLIC_URL__', $PublicUrl.TrimEnd('/')).
                    Replace('__SUPERUSER_EMAIL__', $suEmail).
                    Replace('__SUPERUSER_PASSWORD__', $suPassword).
                    Replace('C:\\DeenTime\\logs', ($logDir -replace '\\', '\\'))
  Set-Content -Path $settings -Value $json -Encoding UTF8
  Write-Host "Wrote $settings (keep this file; it holds the secrets)." -ForegroundColor Green
}

# ── Copy the build (preserve settings + uploads) ─────────────────────────────
$existing = Get-Service -Name $service -ErrorAction SilentlyContinue
if ($existing -and $existing.Status -eq 'Running') { Stop-Service $service; Start-Sleep -Seconds 2 }

$keep = Join-Path $env:TEMP 'deentime-keep'
Remove-Item $keep -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $keep | Out-Null
if (Test-Path $settings) { Copy-Item $settings $keep }
$uploads = Join-Path $appDir 'wwwroot\uploads'
if (Test-Path $uploads) { Copy-Item $uploads (Join-Path $keep 'uploads') -Recurse }

Get-ChildItem $appDir -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
Copy-Item (Join-Path $src '*') $appDir -Recurse -Force
if (Test-Path (Join-Path $keep 'appsettings.Production.json')) { Copy-Item (Join-Path $keep 'appsettings.Production.json') $settings -Force }
if (Test-Path (Join-Path $keep 'uploads')) { Copy-Item (Join-Path $keep 'uploads') $uploads -Recurse -Force }
New-Item -ItemType Directory -Force -Path $uploads | Out-Null

# ── Windows service ──────────────────────────────────────────────────────────
$exe = Join-Path $appDir 'DeenTime.Api.exe'
if (-not $existing) {
  New-Service -Name $service -DisplayName 'IqamaTime (DeenTime API + site)' `
    -BinaryPathName "`"$exe`" --contentRoot `"$appDir`"" -StartupType Automatic | Out-Null
  & sc.exe failure $service reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
  & sc.exe config $service depend= $($pgService.Name) 2>$null | Out-Null
}
# Scope ASPNETCORE_ENVIRONMENT=Production to this service only (not machine-wide)
# so it loads appsettings.Production.json.
$regKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$service"
New-ItemProperty -Path $regKey -Name 'Environment' -PropertyType MultiString `
  -Value @('ASPNETCORE_ENVIRONMENT=Production') -Force | Out-Null
Start-Service $service

# ── Health check ─────────────────────────────────────────────────────────────
$ok = $false
foreach ($i in 1..40) {
  try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8080/health/ready' -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch {}
  Start-Sleep -Seconds 2
}
if ($ok) {
  $v = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8080/api/version').Content
  Write-Host "`nIqamaTime is running: http://localhost:8080  ($v)" -ForegroundColor Green
  Write-Host "Logs: $logDir"
} else {
  Write-Warning "Service did not become healthy. Check $logDir and:  Get-EventLog -LogName Application -Source DeenTime -Newest 20"
}
