@echo off
setlocal
cd /d "%~dp0\.."

echo ================================================================
echo     OPENPC-MCP SUITE - INSTALADOR DE INICIO AUTOMATICO
echo ================================================================
echo.
echo Solicitando permisos de Administrador para registrar la tarea en Windows...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"\"%~dp0register-task.ps1\"\"' -Verb RunAs -Wait"

echo.
echo ================================================================
echo ¡Listo! Tarea de inicio automático configurada.
echo Cada vez que inicies sesión en Windows, OpenPC-MCP arrancará
echo en segundo plano con permisos de Administrador.
echo ================================================================
echo.
pause
