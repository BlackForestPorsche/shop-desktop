# Black Forest Tools — Windows Setup (git checkout + shortcuts + auto-update)
# Compiled by CI to Black.Forest.Tools-Setup.exe for the shop Downloads page.
# Desk users should not need to browse GitHub Releases.
#
# Needs Git + Node on PATH (will try winget if missing). Clones/updates
# %USERPROFILE%\shop-desktop, npm install, install-windows.ps1 (Tools +
# shortcuts + 30-minute git update task + login autostart), then launches Tools.

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/BlackForestPorsche/shop-desktop.git"
$Target = Join-Path $env:USERPROFILE "shop-desktop"
$Branch = "main"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message"
}

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [System.Environment]::GetEnvironmentVariable("Path", "User")
}

function Ensure-Cmd {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$WingetId,
    [Parameter(Mandatory = $true)][string]$HintUrl
  )
  if (Get-Command $Name -ErrorAction SilentlyContinue) { return }
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Step "Installing $Name via winget ($WingetId)..."
    winget install --id $WingetId -e --accept-source-agreements --accept-package-agreements
    Refresh-Path
  }
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Need $Name on PATH. Install from $HintUrl then run Setup again."
  }
}

Write-Host "Black Forest Tools Setup"
Write-Host "Installs Tools under $Target, turns on git auto-update,"
Write-Host "and starts Tools at login."

Ensure-Cmd -Name "git" -WingetId "Git.Git" -HintUrl "https://git-scm.com"
Ensure-Cmd -Name "npm" -WingetId "OpenJS.NodeJS.LTS" -HintUrl "https://nodejs.org"

# Same overrides as the in-app check: a saved GitHub token or an elevated
# checkout must not block a public fetch of shop-desktop.
$env:GIT_TERMINAL_PROMPT = "0"
$env:GCM_INTERACTIVE = "never"
function Invoke-SetupGit {
  param([Parameter(Mandatory = $true)][string[]]$GitArgs)
  & git -c "safe.directory=*" -c "credential.helper=" -c "http.https://github.com/.extraheader=" @GitArgs
  return $LASTEXITCODE
}

if (-not (Test-Path (Join-Path $Target ".git"))) {
  if (Test-Path $Target) {
    throw "$Target exists but is not a git checkout. Move it aside and re-run Setup."
  }
  Write-Step "Cloning shop-desktop..."
  $cloneExit = Invoke-SetupGit -GitArgs @("clone", "--branch", $Branch, "--single-branch", $RepoUrl, $Target)
  if ($cloneExit -ne 0) { throw "git clone failed" }
} else {
  Write-Step "Updating existing checkout..."
  $fetchExit = Invoke-SetupGit -GitArgs @("-C", $Target, "fetch", "--quiet", "origin", $Branch)
  if ($fetchExit -ne 0) { throw "git fetch failed" }
  Invoke-SetupGit -GitArgs @("-C", $Target, "checkout", $Branch) | Out-Null
  $mergeExit = Invoke-SetupGit -GitArgs @("-C", $Target, "merge", "--ff-only", "origin/$Branch")
  if ($mergeExit -ne 0) {
    Write-Host "Could not fast-forward (local changes?). Continuing with current tree."
  }
}

Push-Location $Target
try {
  Write-Step "npm install..."
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

  Write-Step "Creating shortcuts and auto-update task..."
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Target "scripts\install-windows.ps1")
  if ($LASTEXITCODE -ne 0) { throw "install-windows.ps1 failed" }

  Write-Host ""
  Write-Host "Setup finished."
  Write-Host "  Tools:  Start Menu -> Black Forest Automotive -> Black Forest Tools"
  Write-Host "  Widget: Start Menu -> Black Forest Automotive -> Black Forest Shop Widget"
  Write-Host "  Folder: $Target"
  Write-Host "  Updates: task BlackForestShopDesktopUpdate (every 30 min)"
  Write-Host "  Login:  Startup folder + Run key (BlackForestTools)"
  Write-Host "  Disable login start: scripts\disable-tools-autostart.ps1"
  Write-Host ""
  Write-Host "Launching Black Forest Tools..."
  $electronExe = Join-Path $Target "node_modules\electron\dist\electron.exe"
  if (Test-Path $electronExe) {
    Start-Process -FilePath $electronExe -ArgumentList "`"$Target`"" -WorkingDirectory $Target
  } else {
    $npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
    if (-not $npmCmd) { $npmCmd = Get-Command npm }
    Start-Process -FilePath $npmCmd.Source -ArgumentList "start" -WorkingDirectory $Target
  }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Press Enter to close Setup."
try { [void][Console]::ReadLine() } catch { Start-Sleep -Seconds 8 }
