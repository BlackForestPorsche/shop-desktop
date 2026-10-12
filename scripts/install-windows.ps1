# Install Black Forest Tools + Shop Widget shortcuts for this Windows user.
# Run from a git checkout so Shop → Check for desktop app updates can git pull.
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1

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

$icon = Join-Path $Root "assets\icon.png"
# Windows shortcuts prefer .ico; fall back to electron.exe if no ico.
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
  -Path (Join-Path $StartMenu "Black Forest Shop Widget.lnk") `
  -TargetPath $npmCmd `
  -Arguments "run widget" `
  -WorkingDirectory $Root `
  -IconLocation $iconLocation `
  -Description "Shop widget windows (lot / book-today / notes)"

# Optional desktop copies (same targets).
New-Shortcut `
  -Path (Join-Path $Desktop "Black Forest Tools.lnk") `
  -TargetPath $npmCmd `
  -Arguments "start" `
  -WorkingDirectory $Root `
  -IconLocation $iconLocation `
  -Description "Live window for shop.blackforestautomotive.com"

New-Shortcut `
  -Path (Join-Path $Desktop "Black Forest Shop Widget.lnk") `
  -TargetPath $npmCmd `
  -Arguments "run widget" `
  -WorkingDirectory $Root `
  -IconLocation $iconLocation `
  -Description "Shop widget windows (lot / book-today / notes)"

# Register a 30-minute user task that fast-forwards this git checkout (same spirit as Plasma timer).
$taskName = "BlackForestShopDesktopUpdate"
$updateScript = Join-Path $Root "scripts\update-git-checkout.ps1"
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

$sessionDir = Join-Path $env:LOCALAPPDATA "blackforest-tools"
New-Item -ItemType Directory -Force -Path $sessionDir | Out-Null

Write-Host ""
Write-Host "Black Forest Tools and Shop Widget shortcuts are ready."
Write-Host "Start Menu: $StartMenu"
Write-Host "Widget session folder: $sessionDir"
Write-Host "Auto-update task: $taskName (every 30 minutes)"
Write-Host ""
Write-Host "Run Tools:  npm start"
Write-Host "Run widget: npm run widget"
Write-Host "Open another widget window for another view (lot / book-today / notes)."
