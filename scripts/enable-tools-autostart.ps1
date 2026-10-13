# Start Black Forest Tools at Windows logon (shop desks, default ON).
# Registers a Startup-folder shortcut and an HKCU Run key. Electron's
# requestSingleInstanceLock keeps a second launch from opening another window.
#
#   powershell -ExecutionPolicy Bypass -File scripts\enable-tools-autostart.ps1
# Opt out: scripts\disable-tools-autostart.ps1

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "Black Forest Tools.lnk"
$RunKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$RunValueName = "BlackForestTools"

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

$electronExe = Join-Path $Root "node_modules\electron\dist\electron.exe"
$npmCmdInfo = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCmdInfo) { $npmCmdInfo = Get-Command npm -ErrorAction SilentlyContinue }

if (Test-Path $electronExe) {
  $target = $electronExe
  $arguments = "`"$Root`""
  $iconLocation = "$electronExe,0"
} elseif ($npmCmdInfo) {
  $target = $npmCmdInfo.Source
  $arguments = "start"
  $iconLocation = ""
} else {
  throw "Need electron under node_modules or npm on PATH. Run npm install in $Root first."
}

New-Item -ItemType Directory -Force -Path $StartupDir | Out-Null
New-Shortcut `
  -Path $ShortcutPath `
  -TargetPath $target `
  -Arguments $arguments `
  -WorkingDirectory $Root `
  -IconLocation $iconLocation `
  -Description "Open Black Forest Tools at login"

# Run key uses the same target so logon still works if Startup folder is cleaned.
$runCommand = if ($arguments) { "`"$target`" $arguments" } else { "`"$target`"" }
if (-not (Test-Path $RunKeyPath)) {
  New-Item -Path $RunKeyPath -Force | Out-Null
}
New-ItemProperty -Path $RunKeyPath -Name $RunValueName -Value $runCommand -PropertyType String -Force | Out-Null

Write-Host "Login autostart: Startup shortcut -> $ShortcutPath"
Write-Host "Login autostart: Run key -> $RunKeyPath\$RunValueName"
Write-Host "Disable: powershell -ExecutionPolicy Bypass -File `"$PSScriptRoot\disable-tools-autostart.ps1`""
