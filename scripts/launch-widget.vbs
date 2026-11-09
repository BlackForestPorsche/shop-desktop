' Launch Black Forest Shop Widget windows from a git checkout.
' Forwards --widget (and any extra args) through launch-tools.vbs.
Option Explicit
Dim sh, fso, here, tools, cmd, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
tools = here & "\launch-tools.vbs"
If Not fso.FileExists(tools) Then
  sh.Popup "Missing launch-tools.vbs next to launch-widget.vbs.", 0, "Black Forest Shop Widget", 16
  WScript.Quit 1
End If
cmd = "wscript.exe //nologo """ & tools & """ --widget"
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
