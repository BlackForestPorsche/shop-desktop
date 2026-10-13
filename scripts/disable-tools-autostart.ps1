# Stop Black Forest Tools from launching at Windows logon.

$ErrorActionPreference = "Stop"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "Black Forest Tools.lnk"
$RunKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$RunValueName = "BlackForestTools"

if (Test-Path $ShortcutPath) {
  Remove-Item -Force $ShortcutPath
  Write-Host "Removed Startup shortcut: $ShortcutPath"
} else {
  Write-Host "No Startup shortcut at: $ShortcutPath"
}

if (Get-ItemProperty -Path $RunKeyPath -Name $RunValueName -ErrorAction SilentlyContinue) {
  Remove-ItemProperty -Path $RunKeyPath -Name $RunValueName -Force
  Write-Host "Removed Run key: $RunValueName"
} else {
  Write-Host "No Run key named $RunValueName"
}

Write-Host "Black Forest Tools will no longer start at login."
