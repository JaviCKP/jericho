#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getPlatformInfo, isWindows } = require('../src/utils/platform');
const config = require('../src/config');

console.log('================================================================');
console.log('           OPENPC-MCP SUITE - DIAGNÓSTICO (DOCTOR)              ');
console.log('================================================================\n');

let passedChecks = 0;
let totalChecks = 0;

function check(label, pass, details = '') {
  totalChecks++;
  if (pass) {
    passedChecks++;
    console.log(`  ✅ [PASS] ${label} ${details ? `(${details})` : ''}`);
  } else {
    console.log(`  ❌ [FAIL] ${label} ${details ? `(${details})` : ''}`);
  }
}

// 1. Entorno Node.js
const nodeVersion = process.version;
const majorNode = parseInt(nodeVersion.replace('v', '').split('.')[0], 10);
check('Versión de Node.js', majorNode >= 18, `${nodeVersion} - Mínimo requerido: v18+`);

// 2. Información del Sistema
const plat = getPlatformInfo();
check('Sistema Operativo', true, `${plat.os} (${plat.release}) - Arquitectura: ${plat.architecture}`);
check('Permisos de Administrador / Elevación', true, plat.elevationLabel);

// 3. Binario tunnel-client
const binaryName = isWindows ? 'tunnel-client.exe' : 'tunnel-client';
const binaryPath = path.join(config.rootDir, 'bin', binaryName);
const binaryExists = fs.existsSync(binaryPath);
check('Binario tunnel-client de OpenAI', binaryExists, binaryExists ? binaryPath : 'No encontrado. Ejecuta npm run download-binaries');

// 4. Variables de Configuración
const hasTunnelId = !!config.tunnelId && config.tunnelId.startsWith('tunnel_');
check('CONTROL_PLANE_TUNNEL_ID', hasTunnelId, hasTunnelId ? config.tunnelId : 'Falta configurar en .env');

const hasApiKey = !!config.apiKey && config.apiKey.startsWith('sk-');
check('CONTROL_PLANE_API_KEY', hasApiKey, hasApiKey ? 'sk-***[CONFIGURADA]***' : 'Falta configurar en .env');

// 5. Directorios de Datos y Workspace
check('Directorio de datos (checkpoints/memoria)', fs.existsSync(config.dataDir), config.dataDir);
check('Directorio de trabajo (ChatGPT-Workspace)', fs.existsSync(config.workspaceDir), config.workspaceDir);

console.log('\n================================================================');
if (passedChecks === totalChecks) {
  console.log(`🎉 ¡TODO CORRECTO! (${passedChecks}/${totalChecks} comprobaciones superadas)`);
  console.log('Tu servidor MCP está listo para conectarse a ChatGPT web.');
  console.log('Para iniciar: npm start (o ejecuta scripts/start.bat)');
} else {
  console.log(`⚠️ ATENCIÓN: ${passedChecks}/${totalChecks} comprobaciones superadas.`);
  console.log('Por favor, completa los pasos fallidos ejecutando: npm run setup');
}
console.log('================================================================\n');
