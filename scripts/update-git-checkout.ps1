# Pull shop-desktop from GitHub and npm install when HEAD moved.
# Same spirit as scripts/update-plasma-widget.sh (ff-only pull + package update).
# Safe to run from Task Scheduler via background-update.vbs (window style 0).
# Does not restart running Electron windows (Tools / widget prompt Update and restart
# on their own timers / menus).
#
# KEEP THIS FILE ASCII-ONLY (Windows PowerShell 5.1 misreads UTF-8 without BOM).

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")

if (-not (Test-Path (Join-Path $Root ".git"))) {
  Write-Error "shop-desktop is not a git checkout; cannot auto-update."
  exit 1
}

function Resolve-GitExe {
  $cmd = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  $candidates = @(
    (Join-Path $env:ProgramFiles "Git\cmd\git.exe"),
    (Join-Path $env:ProgramFiles "Git\bin\git.exe"),
    $(if ($programFilesX86) { Join-Path $programFilesX86 "Git\cmd\git.exe" }),
    (Join-Path $env:LOCALAPPDATA "Programs\Git\cmd\git.exe")
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  return $null
}

$GitExe = Resolve-GitExe
if (-not $GitExe) {
  Write-Error "git is not on PATH."
  exit 1
}

# Console-subsystem children (git.exe, npm.cmd) flash a window unless CreateNoWindow is set.
# Parent may already be hidden via background-update.vbs; this covers direct Task Scheduler runs too.
function Invoke-NoWindow {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$Arguments,
    [string]$WorkingDirectory = $Root
  )
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FilePath
  $psi.Arguments = $Arguments
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = $true
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  [void]$p.Start()
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  return @{
    ExitCode = $p.ExitCode
    StdOut = $stdout
    StdErr = $stderr
  }
}

function Invoke-Git {
  param([Parameter(Mandatory = $true)][string]$GitArgs)
  $env:GIT_TERMINAL_PROMPT = "0"
  $env:GCM_INTERACTIVE = "never"
  # Drop a stale GitHub token / credential helper and trust this checkout
  # (Setup-as-admin leaves dubious ownership). Same flags as the in-app check.
  $prefix = "-c safe.directory=* -c credential.helper= -c http.https://github.com/.extraheader="
  return Invoke-NoWindow -FilePath $GitExe -Arguments "$prefix $GitArgs"
}

Push-Location $Root
try {
  $branchResult = Invoke-Git -GitArgs "rev-parse --abbrev-ref HEAD"
  if ($branchResult.ExitCode -ne 0) {
    Write-Error "git rev-parse --abbrev-ref failed: $($branchResult.StdErr)"
    exit 1
  }
  $branch = $branchResult.StdOut.Trim()
  $oldResult = Invoke-Git -GitArgs "rev-parse HEAD"
  $old = $oldResult.StdOut.Trim()

  $fetch = Invoke-Git -GitArgs "fetch --quiet origin $branch"
  if ($fetch.ExitCode -ne 0) {
    Write-Host "git fetch failed (network?). Skipping."
    exit 0
  }

  $merge = Invoke-Git -GitArgs "merge --ff-only origin/$branch"
  if ($merge.ExitCode -ne 0) {
    Write-Host "Could not fast-forward $branch (local changes?). Skipping."
    exit 0
  }

  $newResult = Invoke-Git -GitArgs "rev-parse HEAD"
  $new = $newResult.StdOut.Trim()
  if ($old -eq $new) {
    exit 0
  }
  Write-Host "Updated $old -> $new"
  # npm install rewrites node_modules (including electron.exe) under a running Tools /
  # widget, so only run it when the dependency manifests actually changed.
  $diff = Invoke-Git -GitArgs "diff --name-only $old $new"
  $changed = @($diff.StdOut -split "`r?`n" | Where-Object { $_ })
  $depsChanged = $changed | Where-Object {
    $_ -eq "package.json" -or $_ -eq "package-lock.json" -or $_ -like "labels/package*.json" -or $_ -like "scripts/postinstall-*"
  }
  if (-not $depsChanged) {
    Write-Host "Dependencies unchanged; skipping npm install."
    exit 0
  }
  # npm.cmd is a batch file; run through cmd.exe with CreateNoWindow.
  $npm = Invoke-NoWindow -FilePath "cmd.exe" -Arguments "/c npm install"
  if ($npm.ExitCode -ne 0) {
    Write-Error "npm install failed after pull: $($npm.StdErr)"
    exit 1
  }
} finally {
  Pop-Location
}
