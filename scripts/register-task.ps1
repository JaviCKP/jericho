# Registra la suite OpenPC-MCP en el Programador de Tareas de Windows con elevación de Administrador
$RootDir = Split-Path -Parent $PSScriptRoot
$TaskName = "OpenPC-MCP-Server"
$VbsPath = Join-Path $RootDir "scripts\start-silent.vbs"

$Action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$VbsPath`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([System.TimeSpan]::Zero) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force

Write-Host "✅ Tarea programada '$TaskName' creada con éxito." -ForegroundColor Green
Write-Host "El servidor MCP se iniciará automáticamente en segundo plano como Administrador en cada encendido de PC." -ForegroundColor Cyan
