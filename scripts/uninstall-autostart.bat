@echo off
setlocal
cd /d "%~dp0\.."

echo Eliminando tarea programada OpenPC-MCP-Server...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Unregister-ScheduledTask -TaskName 'OpenPC-MCP-Server' -Confirm:$false -ErrorAction SilentlyContinue; Write-Host 'Tarea eliminada correctamente.' -ForegroundColor Green"
pause
