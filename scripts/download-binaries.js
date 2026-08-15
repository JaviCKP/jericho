#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const REPO = 'openai/tunnel-client';
const binDir = path.resolve(__dirname, '../bin');

if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

function getPlatformBinaryName() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32') {
    return arch === 'arm64' ? 'tunnel-client-v0.0.11-windows-arm64.zip' : 'tunnel-client-v0.0.11-windows-amd64.zip';
  } else if (platform === 'darwin') {
    return arch === 'arm64' ? 'tunnel-client-v0.0.11-darwin-arm64.zip' : 'tunnel-client-v0.0.11-darwin-amd64.zip';
  } else if (platform === 'linux') {
    return arch === 'arm64' ? 'tunnel-client-v0.0.11-linux-arm64.zip' : 'tunnel-client-v0.0.11-linux-amd64.zip';
  }
  return null;
}

async function fetchLatestRelease() {
  console.log('🔍 Buscando binarios oficiales de OpenAI tunnel-client...');
  const assetName = getPlatformBinaryName();

  if (!assetName) {
    console.error(`❌ Plataforma no soportada automáticamente: ${process.platform} (${process.arch})`);
    process.exit(1);
  }

  const binaryExe = process.platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client';
  const targetExePath = path.join(binDir, binaryExe);

  if (fs.existsSync(targetExePath)) {
    console.log(`✅ Binario ${binaryExe} ya disponible en: ${targetExePath}`);
    return;
  }

  const downloadUrl = `https://github.com/${REPO}/releases/download/v0.0.11/${assetName}`;
  const zipPath = path.join(binDir, 'tunnel-client-download.zip');

  console.log(`⬇️ Descargando ${assetName} desde GitHub...`);

  const file = fs.createWriteStream(zipPath);
  https.get(downloadUrl, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      https.get(response.headers.location, (redirectRes) => {
        redirectRes.pipe(file);
        file.on('finish', () => {
          file.close();
          extractAndCleanup(zipPath);
        });
      });
    } else {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        extractAndCleanup(zipPath);
      });
    }
  }).on('error', (err) => {
    fs.unlinkSync(zipPath);
    console.error('❌ Error descargando binario:', err.message);
  });
}

function extractAndCleanup(zipPath) {
  console.log('📦 Descomprimiendo binarios...');
  try {
    if (process.platform === 'win32') {
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${binDir}' -Force"`);
    } else {
      execSync(`unzip -o "${zipPath}" -d "${binDir}"`);
      execSync(`chmod +x "${path.join(binDir, 'tunnel-client')}"`);
    }
    fs.unlinkSync(zipPath);
    console.log('✅ Binarios instalados correctamente en la carpeta bin/.');
  } catch (e) {
    console.error('❌ Error descomprimiendo:', e.message);
  }
}

fetchLatestRelease();
