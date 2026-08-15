#!/usr/bin/env bash
# ================================================================
#  Jericho Setup Script for macOS & Linux
# ================================================================
set -e

echo "🏰 Iniciando configuración de JERICHO para macOS / Linux..."

# Verificar Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js no está instalado. Instálalo desde https://nodejs.org/"
    exit 1
fi

# Instalar dependencias si no existen
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependencias de Node.js..."
    npm install
fi

# Ejecutar asistente interactivo de configuración
node scripts/setup.js
