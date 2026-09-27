Option Explicit
Dim shell, fso, base, code
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = base
code = shell.Run("node """ & base & "\scripts\launch-desktop.mjs""", 0, True)
If code <> 0 Then MsgBox "Worker desktop could not start. See collector/README.md for setup.", 48, "Library Worker"
