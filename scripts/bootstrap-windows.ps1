# Black Forest Tools — one-shot Windows install utility (git checkout + shortcuts).
# Double-click or:
#   powershell -ExecutionPolicy Bypass -File bootstrap-windows.ps1
#
# Needs Git for Windows + Node.js LTS on PATH. Clones to %USERPROFILE%\shop-desktop
# (or updates it), npm install, then install-windows.ps1 (Tools + Widget shortcuts
# + 30-minute git update task). Prefer this over browsing GitHub release pages.

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/BlackForestPorsche/shop-desktop.git"
$Target = Join-Path $env:USERPROFILE "shop-desktop"

function Ensure-Cmd($name, $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name not found. $hint"
  }
}

Ensure-Cmd "git" "Install Git for Windows from https://git-scm.com then re-run."
Ensure-Cmd "npm" "Install Node.js LTS from https://nodejs.org then re-run."

if (-not (Test-Path (Join-Path $Target ".git"))) {
  if (Test-Path $Target) {
    throw "$Target exists but is not a git checkout. Move it aside and re-run."
  }
  Write-Host "Cloning shop-desktop..."
  git clone $RepoUrl $Target
} else {
  Write-Host "Updating existing checkout..."
  git -C $Target fetch --quiet origin
  git -C $Target pull --ff-only origin main
}

Push-Location $Target
try {
  Write-Host "npm install..."
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
  Write-Host "Installing shortcuts and update task..."
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Target "scripts\install-windows.ps1")
  Write-Host ""
  Write-Host "Done. Starting Black Forest Tools..."
  Start-Process npm -ArgumentList "start" -WorkingDirectory $Target -WindowStyle Hidden
  Write-Host "Widget: Start Menu → Black Forest Shop Widget  (or: npm run widget)"
} finally {
  Pop-Location
}
