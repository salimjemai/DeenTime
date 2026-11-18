<#
.SYNOPSIS
  Run the MasjidHub API on this Windows PC as the origin behind a Cloudflare Tunnel.

.DESCRIPTION
  The website is served by Cloudflare Pages; this PC only runs the Node.js API (bound to
  127.0.0.1) and PostgreSQL, and a Cloudflare Tunnel publishes the API to the Pages
  proxy. Nothing here needs an elevated PowerShell. See docs\cloudflare-deployment.md.

      powershell -ExecutionPolicy Bypass -File .\deploy\cloudflare\masjidhub-origin.ps1 <action>

  Actions
    status          What is installed and whether the API answers locally and publicly.
    deploy          Build backend-node from this checkout, install it to <InstallDir>\app
                    (the build it replaces is kept as app.previous), restart, health-check,
                    and switch back automatically if the new build does not become ready.
    rollback        Switch back to app.previous.
    install         Register the scheduled tasks that start the API (and the tunnel, once
                    tunnel-setup has run) with Windows. Elevated: at boot, without anyone
                    signed in. Not elevated: when you sign in.
    uninstall       Remove those tasks.
    start | stop | restart
    tunnel-setup    After "cloudflared tunnel login": create the tunnel, point
                    <OriginHostname> at it and write <InstallDir>\cloudflared\config.yml.
    push-proxy-key  Send Proxy__SharedKey to the Pages project as ORIGIN_PROXY_KEY (needs
                    "npx wrangler login" or CLOUDFLARE_API_TOKEN), and to the GitHub secret
                    MASJIDHUB_PROXY_KEY when -GitHubRepo owner/name is given. Never printed.
    run | run-tunnel  Foreground loops the scheduled tasks execute; useful for debugging.

  Files (all outside the repository)
    <InstallDir>\masjidhub.env          production settings and secrets (see masjidhub.env.example)
    <InstallDir>\app, app.previous      current and previous API builds; uploads live in app\wwwroot\uploads
    <InstallDir>\cloudflared\config.yml tunnel configuration
    <InstallDir>\logs                   api-YYYYMMDD.log, tunnel-YYYYMMDD.log (30 days kept)
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('status', 'deploy', 'rollback', 'install', 'uninstall', 'start', 'stop', 'restart', 'tunnel-setup', 'push-proxy-key', 'run', 'run-tunnel')]
  [string]$Action = 'status',
  [string]$InstallDir = 'C:\MasjidHub',
  [int]$Port = 5080,
  [string]$PublicUrl = 'https://masjidhub.jemaiinnovations.com',
  [string]$OriginHostname = 'masjidhub-origin.jemaiinnovations.com',
  [string]$TunnelName = 'masjidhub',
  [string]$PagesProject = 'masjidhub',
  # deploy: copy uploaded files that are missing from another install (for example the
  # development checkout's backend-node\wwwroot\uploads). Existing files are not replaced.
  [string]$ImportUploadsFrom = '',
  [string]$GitHubRepo = '',
  [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'

$PublicUrl    = $PublicUrl.TrimEnd('/')
$appDir       = Join-Path $InstallDir 'app'
$previousDir  = Join-Path $InstallDir 'app.previous'
$stagingDir   = Join-Path $InstallDir 'app.new'
$logDir       = Join-Path $InstallDir 'logs'
$envFile      = Join-Path $InstallDir 'masjidhub.env'
$tunnelDir    = Join-Path $InstallDir 'cloudflared'
$tunnelConfig = Join-Path $tunnelDir 'config.yml'
$installedScript = Join-Path $InstallDir 'masjidhub-origin.ps1'
$apiTask      = 'MasjidHub API'
$tunnelTask   = 'MasjidHub Tunnel'
$localUrl     = "http://127.0.0.1:$Port"

function Test-Elevated {
  $principal = New-Object Security.Principal.WindowsPrincipal ([Security.Principal.WindowsIdentity]::GetCurrent())
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function New-HexSecret([int]$Bytes = 32) {
  $buffer = New-Object byte[] $Bytes
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
  return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function Read-EnvFile([string]$Path) {
  $values = [ordered]@{}
  if (-not (Test-Path $Path)) { return $values }
  foreach ($line in Get-Content $Path) {
    if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }
    $values[$Matches[1]] = $Matches[2].Trim()
  }
  return $values
}

function Get-NodePath {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) {
    $fallback = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path $fallback) { $node = $fallback }
  }
  if (-not $node) { throw 'Node.js is not installed. Install it first:  winget install OpenJS.NodeJS.LTS' }
  return $node
}

function Get-CloudflaredPath {
  $found = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
  if ($found) { return $found }
  foreach ($candidate in @(
      (Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'),
      (Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe'),
      (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\cloudflared.exe'))) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  throw 'cloudflared is not installed. Install it first:  winget install Cloudflare.cloudflared'
}

function Get-Task([string]$Name) { return Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue }

function Get-ApiProcessId {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { return [int]$listener.OwningProcess }
  return 0
}

function Test-ApiReady {
  try { return (Invoke-WebRequest -UseBasicParsing -Uri "$localUrl/health/ready" -TimeoutSec 3).StatusCode -eq 200 } catch { return $false }
}

function Wait-ApiReady([int]$Seconds = 120) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-ApiReady) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Stop-Api {
  $task = Get-Task $apiTask
  if ($task -and $task.State -eq 'Running') { Stop-ScheduledTask -TaskName $apiTask }
  $processId = Get-ApiProcessId
  if ($processId -gt 0) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -ne 'node') { throw "Port $Port is used by $($process.ProcessName) (process $processId), not by the MasjidHub API." }
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
}

function Stop-Tunnel {
  $task = Get-Task $tunnelTask
  if ($task -and $task.State -eq 'Running') { Stop-ScheduledTask -TaskName $tunnelTask }
  Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($tunnelConfig) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Start-Installed {
  if (Get-Task $apiTask) { Start-ScheduledTask -TaskName $apiTask } else { Write-Warning "The '$apiTask' task is not registered yet. Run:  masjidhub-origin.ps1 install" }
  if (Get-Task $tunnelTask) { Start-ScheduledTask -TaskName $tunnelTask }
}

function Remove-OldLogs {
  Get-ChildItem $logDir -Filter '*.log' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force -ErrorAction SilentlyContinue
}

# Moves the uploaded files along with the live build, so a switch never loses or copies them.
function Move-Uploads([string]$From, [string]$To) {
  $source = Join-Path $From 'wwwroot\uploads'
  $target = Join-Path $To 'wwwroot\uploads'
  if (-not (Test-Path $source)) { return }
  New-Item -ItemType Directory -Force -Path (Join-Path $To 'wwwroot') | Out-Null
  if (Test-Path $target) {
    if (Get-ChildItem $target -Force | Select-Object -First 1) { throw "Both $source and $target hold files; merge them by hand before switching builds." }
    Remove-Item $target -Force
  }
  Move-Item $source $target
}

function Invoke-Checked([string]$What, [scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

function Initialize-EnvFile {
  if (Test-Path $envFile) { return }
  $template = Join-Path $PSScriptRoot 'masjidhub.env.example'
  if (-not (Test-Path $template)) { throw "$envFile does not exist and the template masjidhub.env.example was not found next to this script." }
  $publicHost = ([Uri]$PublicUrl).Host
  $lines = Get-Content $template | ForEach-Object {
    $line = $_.Replace('__PUBLIC_URL__', $PublicUrl).Replace('__PUBLIC_HOST__', $publicHost)
    if ($line -match '^[A-Za-z_][A-Za-z0-9_]*=__GENERATED__$') { $line = $line.Replace('__GENERATED__', (New-HexSecret)) }
    $line
  }
  Set-Content -Path $envFile -Value $lines -Encoding ASCII
  # Secrets: this Windows account only.
  & icacls.exe $envFile /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):(F)" | Out-Null
  Write-Host "Created $envFile with a new signing key and proxy key (not shown). Review the optional settings in it." -ForegroundColor Green
}

function Invoke-Deploy {
  $repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
  $backend = Join-Path $repo 'backend-node'
  if (-not (Test-Path (Join-Path $backend 'package.json'))) { throw "backend-node was not found at $backend. Run deploy from the repository checkout (deploy\cloudflare\masjidhub-origin.ps1)." }
  $null = Get-NodePath
  New-Item -ItemType Directory -Force -Path $InstallDir, $logDir | Out-Null

  if (-not $SkipBuild) {
    Write-Host '==> Building the API' -ForegroundColor Cyan
    Push-Location $backend
    try {
      if (-not (Test-Path 'node_modules')) { Invoke-Checked 'npm ci' { npm ci --no-audit --no-fund } }
      Invoke-Checked 'The API build' { npm run -s build }
    } finally { Pop-Location }
  }
  if (-not (Test-Path (Join-Path $backend 'dist\main.js'))) { throw 'backend-node\dist\main.js is missing; run deploy without -SkipBuild.' }

  Write-Host "==> Staging the build in $stagingDir" -ForegroundColor Cyan
  if (Test-Path $stagingDir) { Remove-Item $stagingDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null
  Copy-Item (Join-Path $backend 'dist') (Join-Path $stagingDir 'dist') -Recurse
  Copy-Item (Join-Path $backend 'prisma') (Join-Path $stagingDir 'prisma') -Recurse
  Copy-Item (Join-Path $backend 'package.json'), (Join-Path $backend 'package-lock.json'), (Join-Path $backend 'appsettings.json') $stagingDir
  Push-Location $stagingDir
  try { Invoke-Checked 'npm ci (production dependencies)' { npm ci --omit=dev --no-audit --no-fund --ignore-scripts } } finally { Pop-Location }
  $sha = 'local'
  try { $resolved = (& git -C $repo rev-parse --short HEAD 2>$null); if ($LASTEXITCODE -eq 0 -and $resolved) { $sha = "$resolved".Trim() } } catch { $sha = 'local' }
  Set-Content -Path (Join-Path $stagingDir 'release.env') -Encoding ASCII -Value @(
    "Build__CommitSha=$sha",
    "Build__TimeUtc=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))")

  Initialize-EnvFile
  Copy-Item (Join-Path $PSScriptRoot 'masjidhub-origin.ps1'), (Join-Path $PSScriptRoot 'masjidhub.env.example'), (Join-Path $PSScriptRoot 'cloudflared-config.example.yml') $InstallDir -Force

  Write-Host '==> Switching builds' -ForegroundColor Cyan
  $hadApp = Test-Path $appDir
  Stop-Api
  if ($hadApp) {
    Move-Uploads $appDir $stagingDir
    if (Test-Path $previousDir) { Remove-Item $previousDir -Recurse -Force }
    Rename-Item $appDir 'app.previous'
  }
  Rename-Item $stagingDir 'app'
  $uploads = Join-Path $appDir 'wwwroot\uploads'
  New-Item -ItemType Directory -Force -Path $uploads | Out-Null
  if ($ImportUploadsFrom) {
    if (-not (Test-Path $ImportUploadsFrom)) { throw "-ImportUploadsFrom: $ImportUploadsFrom does not exist." }
    & robocopy.exe $ImportUploadsFrom $uploads /E /XC /XN /XO /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copying uploads from $ImportUploadsFrom failed (robocopy exit code $LASTEXITCODE)." }
    $global:LASTEXITCODE = 0
  }

  if (-not (Get-Task $apiTask)) {
    Write-Host "Build $sha installed in $appDir." -ForegroundColor Green
    Write-Host 'Next:  masjidhub-origin.ps1 install   (start it now and with Windows)'
    return
  }
  Start-Installed
  if (Wait-ApiReady) {
    $version = (Invoke-WebRequest -UseBasicParsing -Uri "$localUrl/api/version").Content
    Write-Host "MasjidHub API is ready on $localUrl ($version)" -ForegroundColor Green
    return
  }
  if ($hadApp) {
    Write-Warning 'The new build did not become ready; switching back to the previous one.'
    Switch-ToPrevious
    throw "Deploy failed and was rolled back. See the newest api-*.log in $logDir."
  }
  throw "The API did not become ready. See the newest api-*.log in $logDir."
}

function Switch-ToPrevious {
  if (-not (Test-Path $previousDir)) { throw "There is no previous build in $previousDir." }
  Stop-Api
  $failedDir = Join-Path $InstallDir 'app.rolledback'
  if (Test-Path $failedDir) { Remove-Item $failedDir -Recurse -Force }
  Move-Uploads $appDir $previousDir
  Rename-Item $appDir 'app.rolledback'
  Rename-Item $previousDir 'app'
  Rename-Item $failedDir 'app.previous'
  Start-Installed
  if ((Get-Task $apiTask) -and -not (Wait-ApiReady)) { throw "The previous build did not become ready either. See the newest api-*.log in $logDir." }
  Write-Host 'Switched back to the previous build. Database migrations are not undone by a rollback.' -ForegroundColor Yellow
}

function Register-OriginTask([string]$Name, [string]$RunAction, [string]$Description) {
  $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$installedScript`" $RunAction -InstallDir `"$InstallDir`" -Port $Port"
  $taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $InstallDir
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $user = "$($env:USERDOMAIN)\$($env:USERNAME)"
  if (Test-Elevated) {
    # At boot, with no one signed in. S4U stores no password.
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
    $mode = 'when Windows starts'
  } else {
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $mode = "when $user signs in (run install from an elevated PowerShell to start at boot instead)"
  }
  Register-ScheduledTask -TaskName $Name -Description $Description -Action $taskAction -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Write-Host "Registered '$Name': starts $mode." -ForegroundColor Green
}

function Invoke-Install {
  if (-not (Test-Path (Join-Path $appDir 'dist\main.js'))) { throw "No build in $appDir yet. Run:  masjidhub-origin.ps1 deploy" }
  if (-not (Test-Path $installedScript)) { Copy-Item (Join-Path $PSScriptRoot 'masjidhub-origin.ps1') $installedScript -Force }
  Stop-Api
  Register-OriginTask $apiTask 'run' "MasjidHub API (Node.js) on 127.0.0.1:$Port, the origin behind the Cloudflare Tunnel."
  if (Test-Path $tunnelConfig) {
    Stop-Tunnel
    Register-OriginTask $tunnelTask 'run-tunnel' "Cloudflare Tunnel that publishes the MasjidHub API as $OriginHostname."
  } else {
    Write-Warning "No tunnel configuration at $tunnelConfig yet, so only the API task was registered. Run tunnel-setup, then install again."
  }
  Start-Installed
  if (Wait-ApiReady) { Write-Host "MasjidHub API is ready on $localUrl" -ForegroundColor Green }
  else { throw "The API did not become ready. See the newest api-*.log in $logDir." }
}

function Invoke-Uninstall {
  Stop-Api
  Stop-Tunnel
  foreach ($name in $apiTask, $tunnelTask) {
    if (Get-Task $name) { Unregister-ScheduledTask -TaskName $name -Confirm:$false; Write-Host "Removed '$name'." }
  }
  Write-Host "The build, settings and uploads in $InstallDir were left in place."
}

function Invoke-RunLoop([string]$LogPrefix, [string]$WorkingDirectory, [string]$CommandLine) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  while ($true) {
    Remove-OldLogs
    $log = Join-Path $logDir ("{0}-{1}.log" -f $LogPrefix, (Get-Date -Format 'yyyyMMdd'))
    Add-Content -Path $log -Encoding ASCII -Value ("[{0}] starting: {1}" -f (Get-Date -Format 's'), $LogPrefix)
    Push-Location $WorkingDirectory
    try { & cmd.exe /d /s /c "$CommandLine >> `"$log`" 2>&1" } finally { Pop-Location }
    Add-Content -Path $log -Encoding ASCII -Value ("[{0}] exited with code {1}; restarting in 5 seconds" -f (Get-Date -Format 's'), $LASTEXITCODE)
    Start-Sleep -Seconds 5
  }
}

function Invoke-Run {
  if (-not (Test-Path (Join-Path $appDir 'dist\main.js'))) { throw "No build in $appDir yet. Run:  masjidhub-origin.ps1 deploy" }
  $settings = Read-EnvFile (Join-Path $appDir 'release.env')
  $production = Read-EnvFile $envFile
  foreach ($key in $production.Keys) { $settings[$key] = $production[$key] }
  if (-not $settings['Auth__SigningKey'] -or $settings['Auth__SigningKey'] -eq '__GENERATED__') { throw "Auth__SigningKey is missing from $envFile. Run deploy once to create the file." }
  foreach ($key in $settings.Keys) { Set-Item -Path "Env:$key" -Value $settings[$key] }
  $env:ASPNETCORE_ENVIRONMENT = 'Production'
  $env:NODE_ENV = 'production'
  # Loopback only: the tunnel is the one way in from outside.
  $env:ASPNETCORE_URLS = "http://127.0.0.1:$Port"
  $running = Get-ApiProcessId
  if ($running -gt 0) { throw "Port $Port is already in use by process $running. Stop it first (masjidhub-origin.ps1 stop)." }
  Invoke-RunLoop 'api' $appDir "`"$(Get-NodePath)`" dist\main.js"
}

function Invoke-RunTunnel {
  if (-not (Test-Path $tunnelConfig)) { throw "No tunnel configuration at $tunnelConfig. Run:  masjidhub-origin.ps1 tunnel-setup" }
  Invoke-RunLoop 'tunnel' $tunnelDir "`"$(Get-CloudflaredPath)`" tunnel --no-autoupdate --config `"$tunnelConfig`" run"
}

function Invoke-TunnelSetup {
  $cloudflared = Get-CloudflaredPath
  $cloudflaredHome = Join-Path $env:USERPROFILE '.cloudflared'
  if (-not (Test-Path (Join-Path $cloudflaredHome 'cert.pem'))) {
    throw "Sign cloudflared in first (opens a browser; choose the zone of $OriginHostname):  cloudflared tunnel login"
  }
  $find = { (& $cloudflared tunnel list --output json --name $TunnelName | Out-String | ConvertFrom-Json) | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1 }
  $tunnel = & $find
  if (-not $tunnel) {
    Invoke-Checked "Creating the tunnel '$TunnelName'" { & $cloudflared tunnel create $TunnelName }
    $tunnel = & $find
  }
  if (-not $tunnel) { throw "The tunnel '$TunnelName' could not be found after creating it." }
  $credentials = Join-Path $cloudflaredHome "$($tunnel.id).json"
  if (-not (Test-Path $credentials)) {
    throw "The tunnel '$TunnelName' exists, but its credentials file $credentials is not on this PC (it was created elsewhere). Delete it in the Cloudflare dashboard or pass another -TunnelName."
  }
  # Creates the CNAME for the origin hostname only; an existing record for another target is left alone and reported.
  Invoke-Checked "Routing $OriginHostname to the tunnel" { & $cloudflared tunnel route dns $TunnelName $OriginHostname }
  New-Item -ItemType Directory -Force -Path $tunnelDir | Out-Null
  Set-Content -Path $tunnelConfig -Encoding ASCII -Value @(
    "# Written by masjidhub-origin.ps1 tunnel-setup (see cloudflared-config.example.yml).",
    "tunnel: $($tunnel.id)",
    "credentials-file: $credentials",
    '',
    'ingress:',
    "  - hostname: $OriginHostname",
    "    service: http://127.0.0.1:$Port",
    '  - service: http_status:404')
  Write-Host "Tunnel '$TunnelName' ($($tunnel.id)) publishes http://127.0.0.1:$Port as https://$OriginHostname" -ForegroundColor Green
  Write-Host 'Next:  masjidhub-origin.ps1 install   (registers and starts the tunnel task)'
}

function Invoke-PushProxyKey {
  $key = (Read-EnvFile $envFile)['Proxy__SharedKey']
  if (-not $key -or $key -eq '__GENERATED__') { throw "Proxy__SharedKey is missing from $envFile. Run deploy once to create the file." }
  $frontend = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')) 'frontend\deentime-web'
  $workingDirectory = $InstallDir
  if (Test-Path $frontend) { $workingDirectory = $frontend }
  Push-Location $workingDirectory
  try { Invoke-Checked 'Setting ORIGIN_PROXY_KEY on the Pages project' { $key | npx --yes wrangler@4 pages secret put ORIGIN_PROXY_KEY --project-name $PagesProject } } finally { Pop-Location }
  Write-Host "ORIGIN_PROXY_KEY is set on the Pages project '$PagesProject'. It applies from the next Pages deployment." -ForegroundColor Green
  if ($GitHubRepo) {
    Invoke-Checked 'Setting the GitHub secret MASJIDHUB_PROXY_KEY' { $key | gh secret set MASJIDHUB_PROXY_KEY --repo $GitHubRepo }
    Write-Host "MASJIDHUB_PROXY_KEY is set on $GitHubRepo." -ForegroundColor Green
  }
}

function Get-HttpStatus([string]$Url) {
  try { return [int](Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 10).StatusCode }
  catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return "no answer ($($_.Exception.Message))"
  }
}

function Invoke-Status {
  Write-Host "Install folder : $InstallDir"
  $release = Read-EnvFile (Join-Path $appDir 'release.env')
  if ($release.Count -gt 0) { Write-Host "Current build  : $($release['Build__CommitSha']) built $($release['Build__TimeUtc'])" } else { Write-Host 'Current build  : none (run deploy)' }
  Write-Host "Previous build : $(if (Test-Path $previousDir) { 'kept in app.previous' } else { 'none' })"
  Write-Host "Settings file  : $(if (Test-Path $envFile) { $envFile } else { 'missing (created by deploy)' })"
  foreach ($name in $apiTask, $tunnelTask) {
    $task = Get-Task $name
    Write-Host ("{0,-15}: {1}" -f $name, $(if ($task) { "$($task.State)" } else { 'not registered' }))
  }
  $processId = Get-ApiProcessId
  Write-Host "Port $Port      : $(if ($processId -gt 0) { "process $processId" } else { 'nothing listening' })"
  Write-Host "Local ready    : $(Get-HttpStatus "$localUrl/health/ready")"
  Write-Host "Tunnel direct  : $(Get-HttpStatus "https://$OriginHostname/health/live")"
  Write-Host "Public site    : $(Get-HttpStatus "$PublicUrl/health/live")   ($PublicUrl/health/live)"
}

switch ($Action) {
  'status'         { Invoke-Status }
  'deploy'         { Invoke-Deploy }
  'rollback'       { Switch-ToPrevious }
  'install'        { Invoke-Install }
  'uninstall'      { Invoke-Uninstall }
  'start'          { Start-Installed; if (Wait-ApiReady) { Write-Host "MasjidHub API is ready on $localUrl" -ForegroundColor Green } else { throw "The API did not become ready. See the newest api-*.log in $logDir." } }
  'stop'           { Stop-Api; Stop-Tunnel; Write-Host 'Stopped.' }
  'restart'        { Stop-Api; Stop-Tunnel; Start-Installed; if (Wait-ApiReady) { Write-Host "MasjidHub API is ready on $localUrl" -ForegroundColor Green } else { throw "The API did not become ready. See the newest api-*.log in $logDir." } }
  'tunnel-setup'   { Invoke-TunnelSetup }
  'push-proxy-key' { Invoke-PushProxyKey }
  'run'            { Invoke-Run }
  'run-tunnel'     { Invoke-RunTunnel }
}
