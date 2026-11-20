' ============================================================
'  Pi Web - background launcher
'  Starts start-pi-web.cmd with no visible window.
'  Reports a non-zero exit (except 100 = already running) in a
'  message box, with the exit code, the log path and its tail.
' ============================================================
Option Explicit

Dim sh, fso, base, cmdline, logfile, rc, msg, f, txt

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base    = fso.GetParentFolderName(WScript.ScriptFullName)
' one log per port; 30141 is the launcher default and what the shortcut uses.
logfile = fso.BuildPath(base, "pi-web-30141.log")
If Not fso.FileExists(logfile) Then logfile = fso.BuildPath(base, "pi-web.log")
cmdline = """" & fso.BuildPath(base, "start-pi-web.cmd") & """ quiet"

rc = sh.Run(cmdline, 0, True)          ' 0 = hidden, True = wait for exit

' 100 = a Pi Web instance was already running; the browser was opened.
If rc = 100 Then WScript.Quit 0
If rc = 0 Then WScript.Quit 0

' Anything else: say what happened instead of guessing from a timer.
msg = "Pi Web stopped (exit code " & rc & ")." & vbCrLf & vbCrLf
msg = msg & "Log: " & logfile & vbCrLf & vbCrLf

If fso.FileExists(logfile) Then
  Set f = fso.OpenTextFile(logfile, 1)
  If Not f.AtEndOfStream Then txt = f.ReadAll()
  f.Close
  If Len(txt) > 1500 Then txt = "..." & Right(txt, 1500)
  msg = msg & txt
Else
  msg = msg & "(no log file was written)"
End If

MsgBox msg, 48, "Pi Web"
WScript.Quit rc
