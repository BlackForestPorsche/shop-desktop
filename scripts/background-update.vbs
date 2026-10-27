' Hidden shop-desktop git update for Task Scheduler.
' Window style 0 = fully hidden (powershell -WindowStyle Hidden still flashes a console).
' KEEP THIS FILE ASCII-ONLY.
On Error Resume Next
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptsDir = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(scriptsDir)
ps1 = scriptsDir & "\update-git-checkout.ps1"
If fso.FileExists(ps1) Then
  sh.CurrentDirectory = root
  cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & ps1 & """"
  sh.Run cmd, 0, True
End If
