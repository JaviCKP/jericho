#!/usr/bin/env bash
# ================================================================
#  Jericho Launcher Script for macOS & Linux
# ================================================================
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

# Cargar variables de entorno desde .env si existe
if [ -f ".env" ]; then
    export $(grep -v '^#' .env | xargs)
fi

echo "================================================================"
echo "   🏰 JERICHO SUITE - LANZADOR (macOS / Linux)"
echo "================================================================"
echo "Panel de control local: http://127.0.0.1:8080/ui"
echo "Presiona Ctrl+C para detener el servidor."
echo "================================================================"

# Ejecutar el binario de tunnel-client adecuado
if [ -f "./bin/tunnel-client" ]; then
    ./bin/tunnel-client run --profile openpc-mcp
elif command -v tunnel-client &> /dev/null; then
    tunnel-client run --profile openpc-mcp
else
    echo "⚠️ Binario de tunnel-client no encontrado en ./bin/. Ejecutando servidor directo..."
    node src/index.js
fi
