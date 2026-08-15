@echo off
setlocal
cd /d "%~dp0\.."

echo ================================================================
echo               JERICHO - SERVIDOR MCP EN EJECUCION
echo ================================================================
echo.

if not exist ".env" (
    echo [AVISO] No se ha encontrado el archivo .env.
    echo Ejecutando asistente de configuracion por primera vez...
    echo.
    node scripts\setup.js
    if not exist ".env" exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if "%%A"=="CONTROL_PLANE_API_KEY" set "CONTROL_PLANE_API_KEY=%%B"
    if "%%A"=="CONTROL_PLANE_TUNNEL_ID" set "CONTROL_PLANE_TUNNEL_ID=%%B"
)

echo Tunnel ID: %CONTROL_PLANE_TUNNEL_ID%
echo Panel de control local: http://127.0.0.1:8080/ui
echo.
echo Mantén esta ventana abierta mientras uses ChatGPT con tu PC.
echo ================================================================
echo.

bin\tunnel-client.exe run --profile openpc-mcp
pause
