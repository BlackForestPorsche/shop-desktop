# Install Black Forest Tools shortcuts + login autostart for this Windows user.
# Run from a git checkout so Shop → Check for desktop app updates can git pull.
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -NoAutostart
#
# First-time desk install without browsing GitHub: scripts\bootstrap-windows.ps1
# Shop desks get login autostart by default (Startup folder + Run key).

param(
  [switch]$NoAutostart
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Black Forest Automotive"
$Desktop = [Environment]::GetFolderPath("Desktop")

function Ensure-Npm {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Install Node.js (LTS) from https://nodejs.org so npm is on PATH, then re-run."
  }
}

function Ensure-Git {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Install Git for Windows from https://git-scm.com, then re-run."
  }
}

function Ensure-Packages {
  if (-not (Test-Path (Join-Path $Root "node_modules\electron"))) {
    Write-Host "Installing packages..."
    Push-Location $Root
    try {
      npm install
    } finally {
      Pop-Location
    }
  }
}

function New-Shortcut {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [string]$Arguments = "",
    [string]$WorkingDirectory = $Root,
    [string]$IconLocation = "",
    [string]$Description = ""
  )
  $shell = New-Object -ComObject WScript.Shell
  $sc = $shell.CreateShortcut($Path)
  $sc.TargetPath = $TargetPath
  $sc.Arguments = $Arguments
  $sc.WorkingDirectory = $WorkingDirectory
  if ($IconLocation) { $sc.IconLocation = $IconLocation }
  if ($Description) { $sc.Description = $Description }
  $sc.Save()
}

Ensure-Git
Ensure-Npm
Ensure-Packages

New-Item -ItemType Directory -Force -Path $StartMenu | Out-Null

$npmCmdInfo = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCmdInfo) { $npmCmdInfo = Get-Command npm }
$npmCmd = $npmCmdInfo.Source

$electronExe = Join-Path $Root "node_modules\electron\dist\electron.exe"
$iconLocation = if (Test-Path $electronExe) { "$electronExe,0" } else { "" }

New-Shortcut `
  -Path (Join-Path $StartMenu "Black Forest Tools.lnk") `
  -TargetPath $npmCmd `
  -Arguments "start" `
  -WorkingDirectory $Root `
  -IconLocation $iconLocation `
  -Description "Live window for shop.blackforestautomotive.com"

New-Shortcut `
  -Path (Join-Path $Desktop "Black Forest Tools.lnk") `
  -TargetPath $npmCmd `
  -Arguments "start" `
  -WorkingDirectory $Root `
  -IconLocation $iconLocation `
  -Description "Live window for shop.blackforestautomotive.com"

# Optional widget shortcuts when this checkout has npm run widget (Setup / widgets branch).
$packageJson = Get-Content (Join-Path $Root "package.json") -Raw
if ($packageJson -match '"widget"\s*:') {
  New-Shortcut `
    -Path (Join-Path $StartMenu "Black Forest Shop Widget.lnk") `
    -TargetPath $npmCmd `
    -Arguments "run widget" `
    -WorkingDirectory $Root `
    -IconLocation $iconLocation `
    -Description "Shop widget windows (lot / book-today / notes)"

  New-Shortcut `
    -Path (Join-Path $Desktop "Black Forest Shop Widget.lnk") `
    -TargetPath $npmCmd `
    -Arguments "run widget" `
    -WorkingDirectory $Root `
    -IconLocation $iconLocation `
    -Description "Shop widget windows (lot / book-today / notes)"
}

# 30-minute user task that fast-forwards this git checkout (same spirit as Plasma timer).
$updateScript = Join-Path $Root "scripts\update-git-checkout.ps1"
if (Test-Path $updateScript) {
  $taskName = "BlackForestShopDesktopUpdate"
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
  $action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$updateScript`"" `
    -WorkingDirectory $Root
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 3650)
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Pull shop-desktop from GitHub and npm install when main moves" | Out-Null
  Write-Host "Auto-update task: $taskName (every 30 minutes)"
}

$sessionDir = Join-Path $env:LOCALAPPDATA "blackforest-tools"
New-Item -ItemType Directory -Force -Path $sessionDir | Out-Null

if (-not $NoAutostart) {
  Write-Host ""
  Write-Host "Enabling start at login..."
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\enable-tools-autostart.ps1")
} else {
  Write-Host ""
  Write-Host "Login autostart skipped (-NoAutostart)."
  Write-Host "Enable later: powershell -ExecutionPolicy Bypass -File `"$Root\scripts\enable-tools-autostart.ps1`""
}

Write-Host ""
Write-Host "Black Forest Tools shortcuts are ready."
Write-Host "Start Menu: $StartMenu"
Write-Host "Widget session folder: $sessionDir"
Write-Host ""
Write-Host "Run Tools:  npm start"
Write-Host "Disable login start: scripts\disable-tools-autostart.ps1"
