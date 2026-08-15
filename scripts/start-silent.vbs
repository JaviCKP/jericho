Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
RootDir = FSO.GetParentFolderName(ScriptDir)
PsFile = RootDir & "\scripts\start-silent.ps1"

WshShell.Run "powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File """ & PsFile & """", 0, False
