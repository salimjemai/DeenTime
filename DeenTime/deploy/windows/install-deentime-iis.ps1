#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Install or update IqamaTime (DeenTime) under IIS on this Windows PC.

.DESCRIPTION
  Run from the unzipped release folder (the one containing app\DeenTime.Api.exe)
  in an elevated PowerShell:

      Set-ExecutionPolicy -Scope Process Bypass -Force
      .\install-deentime-iis.ps1 -PublicUrl https://your-public-hostname

  What it does
    - Enables the IIS features needed and checks the ASP.NET Core Module (ANCM)
      from the .NET Hosting Bundle is present.
    - First run: asks for the PostgreSQL "postgres" password, the site admin
      email/password and the public URL; creates the deentime role/database;
      writes C:\DeenTime\app\appsettings.Production.json (the only secrets file).
    - Copies the build to C:\DeenTime\app, keeping settings and uploads.
    - Creates the "DeenTime" application pool (No Managed Code, Always Running)
      and the "DeenTime" website bound to http://*:80 pointing at the app.
    - Grants the app pool identity the file permissions it needs.
    - Health-checks http://localhost/health/ready.
  Later runs keep the settings and just swap in the new build.

.PARAMETER InstallDir  Where the app lives. Default C:\DeenTime
.PARAMETER PublicUrl   Public origin (e.g. https://xxxx.ngrok-free.app). Default http://localhost
.PARAMETER HttpPort    IIS binding port. Default 80
.PARAMETER PgBin       PostgreSQL bin folder (auto-detected under C:\Program Files\PostgreSQL)
#>
[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\DeenTime',
  [string]$PublicUrl  = '',
  [int]$HttpPort      = 80,
  [string]$PgBin      = ''
)
$ErrorActionPreference = 'Stop'
$here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$src      = Join-Path $here 'app'
$appDir   = Join-Path $InstallDir 'app'
$logDir   = Join-Path $InstallDir 'logs'
$settings = Join-Path $appDir 'appsettings.Production.json'
$siteName = 'DeenTime'
$poolName = 'DeenTime'

if (-not (Test-Path (Join-Path $src 'DeenTime.Api.exe'))) {
  throw "app\DeenTime.Api.exe not found next to this script. Unzip the release first."
}

# ── IIS features + ASP.NET Core Module ───────────────────────────────────────
Write-Host "Checking IIS features..." -ForegroundColor Cyan
$features = 'IIS-WebServerRole','IIS-WebServer','IIS-CommonHttpFeatures','IIS-StaticContent',
            'IIS-DefaultDocument','IIS-HttpErrors','IIS-HttpLogging','IIS-RequestFiltering',
            'IIS-HttpCompressionStatic','IIS-ManagementConsole','IIS-ApplicationInit'
foreach ($f in $features) {
  $state = (Get-WindowsOptionalFeature -Online -FeatureName $f -ErrorAction SilentlyContinue).State
  if ($state -ne 'Enabled') { Enable-WindowsOptionalFeature -Online -FeatureName $f -All -NoRestart | Out-Null }
}
Import-Module WebAdministration

$ancm = Join-Path $env:windir 'System32\inetsrv\aspnetcorev2.dll'
if (-not (Test-Path $ancm)) {
  throw "The ASP.NET Core Module is missing. Install the .NET Hosting Bundle, then re-run:`n    winget install Microsoft.DotNet.HostingBundle.9`n(then run 'iisreset' once)."
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
New-Item -ItemType Directory -Force -Path $appDir, $logDir | Out-Null
$firstRun = -not (Test-Path $settings)
if ($firstRun) {
  Write-Host "`nFirst-time setup" -ForegroundColor Cyan
  $pgAdminPw   = Read-Host -Prompt 'Password of the PostgreSQL "postgres" superuser (set during install)' -AsSecureString
  $dbPassword  = [Convert]::ToBase64String((1..24 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]]) -replace '[^A-Za-z0-9]', ''
  $suEmail     = Read-Host -Prompt 'Super-user (site admin) email'
  $suPassword  = Read-Host -Prompt 'Super-user password'
  if (-not $PublicUrl) { $PublicUrl = Read-Host -Prompt "Public URL (press Enter for http://localhost)" }
  if (-not $PublicUrl) { $PublicUrl = 'http://localhost' }
  $signingKey  = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })

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

# ── Stop the site, copy the build (preserve settings + uploads) ──────────────
if (Test-Path "IIS:\Sites\$siteName") { Stop-Website $siteName -ErrorAction SilentlyContinue }
if (Test-Path "IIS:\AppPools\$poolName") {
  if ((Get-WebAppPoolState $poolName).Value -ne 'Stopped') { Stop-WebAppPool $poolName }
  Start-Sleep -Seconds 2
}

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

# web.config is regenerated by every publish: set the environment so the app
# loads appsettings.Production.json, and send stdout to the log folder.
$webConfigPath = Join-Path $appDir 'web.config'
[xml]$wc = Get-Content $webConfigPath
$aspNetCore = $wc.SelectSingleNode('//aspNetCore')
$aspNetCore.SetAttribute('stdoutLogEnabled', 'true')
$aspNetCore.SetAttribute('stdoutLogFile', (Join-Path $logDir 'stdout'))
$envs = $aspNetCore.SelectSingleNode('environmentVariables')
if (-not $envs) { $envs = $wc.CreateElement('environmentVariables'); $aspNetCore.AppendChild($envs) | Out-Null }
$envs.RemoveAll()
foreach ($pair in @(@('ASPNETCORE_ENVIRONMENT','Production'), @('DOTNET_NOLOGO','1'))) {
  $e = $wc.CreateElement('environmentVariable')
  $e.SetAttribute('name', $pair[0]); $e.SetAttribute('value', $pair[1])
  $envs.AppendChild($e) | Out-Null
}
$wc.Save($webConfigPath)

# ── App pool + site ──────────────────────────────────────────────────────────
if (-not (Test-Path "IIS:\AppPools\$poolName")) { New-WebAppPool -Name $poolName | Out-Null }
Set-ItemProperty "IIS:\AppPools\$poolName" -Name managedRuntimeVersion -Value ''      # No Managed Code
Set-ItemProperty "IIS:\AppPools\$poolName" -Name startMode -Value 'AlwaysRunning'
Set-ItemProperty "IIS:\AppPools\$poolName" -Name processModel.idleTimeout -Value ([TimeSpan]::Zero)
Set-ItemProperty "IIS:\AppPools\$poolName" -Name processModel.identityType -Value 'ApplicationPoolIdentity'

# The Default Web Site also listens on port 80; stop it so it cannot shadow ours.
if ($HttpPort -eq 80 -and (Test-Path 'IIS:\Sites\Default Web Site')) {
  Stop-Website 'Default Web Site' -ErrorAction SilentlyContinue
  Set-ItemProperty 'IIS:\Sites\Default Web Site' -Name serverAutoStart -Value $false
}

if (-not (Test-Path "IIS:\Sites\$siteName")) {
  New-Website -Name $siteName -PhysicalPath $appDir -ApplicationPool $poolName -Port $HttpPort | Out-Null
} else {
  Set-ItemProperty "IIS:\Sites\$siteName" -Name physicalPath -Value $appDir
  Set-ItemProperty "IIS:\Sites\$siteName" -Name applicationPool -Value $poolName
}
# Preload: start the app at boot / after recycles without waiting for a request,
# so the in-process background worker (content sync) runs continuously.
Set-ItemProperty "IIS:\Sites\$siteName" -Name applicationDefaults.preloadEnabled -Value $true

# ── Permissions for the app pool identity ────────────────────────────────────
$identity = "IIS AppPool\$poolName"
& icacls $appDir  /grant "${identity}:(OI)(CI)RX" /T /Q | Out-Null
& icacls $uploads /grant "${identity}:(OI)(CI)M"  /T /Q | Out-Null
& icacls $logDir  /grant "${identity}:(OI)(CI)M"  /T /Q | Out-Null

Start-WebAppPool $poolName
Start-Website $siteName

# ── Health check ─────────────────────────────────────────────────────────────
$base = "http://localhost:$HttpPort"
$ok = $false
foreach ($i in 1..40) {
  try { $r = Invoke-WebRequest -UseBasicParsing -Uri "$base/health/ready" -TimeoutSec 5; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch {}
  Start-Sleep -Seconds 2
}
if ($ok) {
  $v = (Invoke-WebRequest -UseBasicParsing -Uri "$base/api/version").Content
  Write-Host "`nIqamaTime is running under IIS: $base  ($v)" -ForegroundColor Green
  Write-Host "Manage it in IIS Manager (inetmgr): site '$siteName', app pool '$poolName'. Logs: $logDir"
} else {
  Write-Warning "Site did not become healthy. Check $logDir\stdout*.log and the Windows Event Viewer (Application log, source 'IIS AspNetCore Module V2')."
}
