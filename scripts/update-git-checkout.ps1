# Pull shop-desktop from GitHub and npm install when HEAD moved.
# Same spirit as scripts/update-plasma-widget.sh (ff-only pull + package update).
# Safe to run from Task Scheduler; does not restart running Electron windows
# (Tools / widget prompt Update and restart on their own timers / menus).

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")

if (-not (Test-Path (Join-Path $Root ".git"))) {
  Write-Error "shop-desktop is not a git checkout; cannot auto-update."
  exit 1
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error "git is not on PATH."
  exit 1
}

Push-Location $Root
try {
  $branch = (git rev-parse --abbrev-ref HEAD).Trim()
  $old = (git rev-parse HEAD).Trim()
  git fetch --quiet origin $branch
  git merge --ff-only "origin/$branch" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Could not fast-forward $branch (local changes?). Skipping."
    exit 0
  }
  $new = (git rev-parse HEAD).Trim()
  if ($old -eq $new) {
    exit 0
  }
  Write-Host "Updated $old → $new"
  npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Error "npm install failed after pull"
    exit 1
  }
} finally {
  Pop-Location
}
