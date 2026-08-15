const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Cargar .env desde la raíz del proyecto si existe
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const configEnvPath = path.join(rootDir, 'config.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else if (fs.existsSync(configEnvPath)) {
  dotenv.config({ path: configEnvPath });
}

const config = {
  rootDir: rootDir,
  dataDir: path.join(rootDir, 'data'),
  workspaceDir: process.env.CHATGPT_WORKSPACE || path.join(process.env.USERPROFILE || process.env.HOME || rootDir, 'ChatGPT-Workspace'),
  tunnelId: process.env.CONTROL_PLANE_TUNNEL_ID || '',
  apiKey: process.env.CONTROL_PLANE_API_KEY || '',
  defaultTimeoutMs: parseInt(process.env.DEFAULT_TIMEOUT_MS, 10) || 60000,
  maxOutputChars: parseInt(process.env.MAX_OUTPUT_CHARS, 10) || 30000,
  logLevel: process.env.LOG_LEVEL || 'INFO',
  enableGridOverlay: process.env.ENABLE_GRID_OVERLAY === 'true' || false,
};

// Asegurar que existan los directorios clave
if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}
if (!fs.existsSync(config.workspaceDir)) {
  fs.mkdirSync(config.workspaceDir, { recursive: true });
}

module.exports = config;
