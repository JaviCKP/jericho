@echo off
if "%CONTROL_PLANE_API_KEY%"=="" (
  echo Error: CONTROL_PLANE_API_KEY no esta definida en el entorno.
  exit /b 1
)
cd /d "%~dp0"
.\bin\tunnel-client.exe run --profile openpc-mcp
