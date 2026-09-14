<#
.SYNOPSIS
  One-shot local start on Windows: PostgreSQL check, Node.js API build + run, Angular dev server.
  Equivalent of scripts/start-local.sh. Double-click scripts\start-local.cmd or run:

      powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1

  Needs Node.js 22+ (winget install OpenJS.NodeJS.LTS) and PostgreSQL listening on
  127.0.0.1:5432 with the "postgres" superuser (password "postgres" unless -DbPassword is given).
  Secrets come from an untracked DeenTime\.env (see .env.example) or are generated for this run.
#>
[CmdletBinding()]
param(
  [int]$ApiPort = 8080,
  [int]$WebPort = 4200,
  [int]$DbPort = 5432,
  [string]$DbPassword = 'postgres',
  [string]$PgBin = ''
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..')
Set-Location $root

# ── Local .env (KEY=VALUE lines) ─────────────────────────────────────────────
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$' -and -not $line.StartsWith('#')) {
      $value = $Matches[2].Trim('"').Trim("'")
      if (-not [Environment]::GetEnvironmentVariable($Matches[1])) { Set-Item -Path ("Env:" + $Matches[1]) -Value $value }
    }
  }
}

foreach ($tool in 'node', 'npm') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not installed. Install Node.js 22+:  winget install OpenJS.NodeJS.LTS" }
}
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw "Node.js 22 or newer is required (found $(node --version))." }

# ── PostgreSQL ───────────────────────────────────────────────────────────────
if (-not $PgBin) {
  $PgBin = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1 | ForEach-Object { Join-Path $_.FullName 'bin' }
}
$psql = if ($PgBin -and (Test-Path (Join-Path $PgBin 'psql.exe'))) { Join-Path $PgBin 'psql.exe' } else { (Get-Command psql -ErrorAction SilentlyContinue).Source }
if (-not $psql) { throw "PostgreSQL client (psql.exe) not found. Install PostgreSQL 16:  winget install PostgreSQL.PostgreSQL.16" }
$pgService = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgService -and $pgService.Status -ne 'Running') { Start-Service $pgService.Name }
$env:PGPASSWORD = $DbPassword
$ready = $false
foreach ($i in 1..15) {
  try { & $psql -h 127.0.0.1 -p $DbPort -U postgres -d postgres -tAc 'SELECT 1' 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $ready = $true; break } } catch {}
  Start-Sleep -Seconds 1
}
if (-not $ready) { throw "PostgreSQL is not answering on 127.0.0.1:$DbPort for user postgres (password '$DbPassword'). Pass -DbPassword if it differs." }
$dbExists = & $psql -h 127.0.0.1 -p $DbPort -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='deentime'"
if ($dbExists -ne '1') { Write-Host "Creating database 'deentime'..."; & $psql -h 127.0.0.1 -p $DbPort -U postgres -d postgres -qc 'CREATE DATABASE deentime' | Out-Null }
Remove-Item Env:PGPASSWORD

# ── Ports ────────────────────────────────────────────────────────────────────
$owner = Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($owner) { throw "Port $ApiPort is already used by process $($owner.OwningProcess). Stop it or pass -ApiPort." }

# ── Secrets ──────────────────────────────────────────────────────────────────
if (-not $env:DEENTIME_AUTH_SIGNING_KEY) {
  $env:DEENTIME_AUTH_SIGNING_KEY = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
  Write-Warning 'Generated an ephemeral local JWT signing key for this run (add DEENTIME_AUTH_SIGNING_KEY to .env to keep sessions valid across restarts).'
}
$superUserEmail = if ($env:DEENTIME_SUPERUSER_EMAIL) { $env:DEENTIME_SUPERUSER_EMAIL } else { 'salim_jemai@yahoo.com' }
$supportEmail = if ($env:DEENTIME_SUPPORT_EMAIL) { $env:DEENTIME_SUPPORT_EMAIL } else { $superUserEmail }
if (-not $env:DEENTIME_SUPERUSER_PASSWORD) {
  $env:DEENTIME_SUPERUSER_PASSWORD = 'LocalOnly-' + (-join ((1..16) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) }))
  Write-Warning "Generated local super-user credentials: $superUserEmail / $($env:DEENTIME_SUPERUSER_PASSWORD)"
}
$publicBaseUrl = if ($env:DEENTIME_PUBLIC_BASE_URL) { $env:DEENTIME_PUBLIC_BASE_URL } else { "http://127.0.0.1:$WebPort" }

# ── API (Node.js) ────────────────────────────────────────────────────────────
Write-Host 'Building the Node.js API...' -ForegroundColor Cyan
Push-Location (Join-Path $root 'backend-node')
try {
  if (-not (Test-Path 'node_modules')) { npm ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed for backend-node' } }
  npm run -s build; if ($LASTEXITCODE -ne 0) { throw 'API build failed' }
} finally { Pop-Location }

$apiEnv = @{
  ASPNETCORE_ENVIRONMENT      = 'Development'
  ASPNETCORE_URLS             = "http://127.0.0.1:$ApiPort"
  ConnectionStrings__Default  = "Host=localhost;Port=$DbPort;Database=deentime;Username=postgres;Password=$DbPassword"
  Auth__SigningKey            = $env:DEENTIME_AUTH_SIGNING_KEY
  SuperUser__Email            = $superUserEmail
  SuperUser__Password         = $env:DEENTIME_SUPERUSER_PASSWORD
  Support__Email              = $supportEmail
  IslamicContent__HadithApiKey = $(if ($env:DEENTIME_HADITH_API_KEY) { $env:DEENTIME_HADITH_API_KEY } else { '' })
  Frontend__PublicBaseUrl     = $publicBaseUrl
}
foreach ($key in $apiEnv.Keys) { Set-Item -Path "Env:$key" -Value $apiEnv[$key] }
$api = Start-Process -FilePath 'node' -ArgumentList 'dist\main.js' -WorkingDirectory (Join-Path $root 'backend-node') -PassThru -NoNewWindow
try {
  $healthy = $false
  foreach ($i in 1..120) {
    if ($api.HasExited) { throw 'The API process exited before becoming ready.' }
    try { $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$ApiPort/health/ready" -TimeoutSec 2; if ($r.StatusCode -eq 200) { $healthy = $true; break } } catch {}
    Start-Sleep -Seconds 1
  }
  if (-not $healthy) { throw 'The API did not become ready within 120 seconds.' }
  $version = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$ApiPort/api/version").Content
  Write-Host "API ready at http://127.0.0.1:$ApiPort (version: $version)" -ForegroundColor Green

  # ── Angular ──────────────────────────────────────────────────────────────
  Write-Host "Starting Angular at http://127.0.0.1:$WebPort" -ForegroundColor Cyan
  Push-Location (Join-Path $root 'frontend\deentime-web')
  try {
    if (-not (Test-Path 'node_modules')) { npm ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed for the frontend' } }
    npm start -- --host 127.0.0.1 --port $WebPort
  } finally { Pop-Location }
} finally {
  if (-not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
}
