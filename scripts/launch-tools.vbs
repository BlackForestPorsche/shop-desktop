' Launch Black Forest Tools from a git checkout without flashing a console.
' Shortcuts should target this script (not electron.exe alone). Electron with no
' app path opens the default Electron welcome page instead of the shop.
Option Explicit
Dim sh, fso, root, electron, cmd, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetAbsolutePathName(fso.GetParentFolderName(WScript.ScriptFullName) & "\..")
electron = root & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(electron) Then
  sh.Popup "Black Forest Tools is not ready yet." & vbCrLf & vbCrLf &
    "From " & root & " run:" & vbCrLf & "  npm install" & vbCrLf &
    "Or re-run Black.Forest.Tools-Setup.exe.", 0, "Black Forest Tools", 48
  WScript.Quit 1
End If
If Not fso.FileExists(root & "\package.json") Then
  sh.Popup "Missing package.json in:" & vbCrLf & root, 0, "Black Forest Tools", 16
  WScript.Quit 1
End If
sh.CurrentDirectory = root
' "." makes Electron load this checkout (same as `npm start` / `electron .`).
cmd = """"" & electron & """" ."
For i = 0 To WScript.Arguments.Count - 1
  cmd = cmd & " " & QuoteArg(WScript.Arguments(i))
Next
sh.Run cmd, 1, False

Function QuoteArg(value)
  Dim s
  s = CStr(value)
  If InStr(s, " ") > 0 Or InStr(s, """") > 0 Then
    QuoteArg = """" & Replace(s, """", """""") & """"
  Else
    QuoteArg = s
  End If
End Function
