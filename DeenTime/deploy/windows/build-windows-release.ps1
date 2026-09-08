<#
.SYNOPSIS
  Build IqamaTime (API + Angular) on Windows straight from the source checkout,
  ready for install-deentime-iis.ps1.

.DESCRIPTION
  Run from anywhere, e.g. in PowerShell:

      cd D:\Git\DeenTime\DeenTime
      .\deploy\windows\build-windows-release.ps1

  Needs the .NET SDK (9 or later) and Node.js 20+ installed:
      winget install Microsoft.DotNet.SDK.9
      winget install OpenJS.NodeJS.LTS

  Output: <repo>\dist\deentime-windows\  (app\, installers, template, README)
  Then:   cd dist\deentime-windows ; .\install-deentime-iis.ps1
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..\..')
$out  = Join-Path $root 'dist\deentime-windows'
$sha  = try { (git -C $root rev-parse --short HEAD 2>$null) } catch { 'local' }
if (-not $sha) { $sha = 'local' }

foreach ($tool in 'dotnet','npm') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not installed or not on PATH." }
}

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $out 'app') | Out-Null

Write-Host "==> Publishing API (win-x64, self-contained)" -ForegroundColor Cyan
dotnet publish (Join-Path $root 'backend\DeenTime.Api\DeenTime.Api.csproj') `
  --configuration Release --runtime win-x64 --self-contained true `
  -p:Build__CommitSha=$sha --output (Join-Path $out 'app')
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

Write-Host "==> Building Angular (production)" -ForegroundColor Cyan
Push-Location (Join-Path $root 'frontend\deentime-web')
try {
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
  npm run build -- --configuration production
  if ($LASTEXITCODE -ne 0) { throw "Angular build failed" }
} finally { Pop-Location }
New-Item -ItemType Directory -Force -Path (Join-Path $out 'app\wwwroot') | Out-Null
Copy-Item (Join-Path $root 'frontend\deentime-web\dist\deentime-web\browser\*') (Join-Path $out 'app\wwwroot') -Recurse -Force

Write-Host "==> Adding install files" -ForegroundColor Cyan
$w = Join-Path $root 'deploy\windows'
Copy-Item (Join-Path $w 'install-deentime-iis.ps1'), (Join-Path $w 'install-deentime.ps1'),
          (Join-Path $w 'appsettings.Production.template.json'), (Join-Path $w 'README.md') $out

Write-Host "`nRelease ready: $out  (commit $sha)" -ForegroundColor Green
Write-Host "Next (elevated PowerShell):  cd `"$out`" ; .\install-deentime-iis.ps1"
