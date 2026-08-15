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

const dataDir = path.join(rootDir, 'data');

/**
 * Directorio de CONTROL. Contiene la política, el diario de auditoría, las
 * aprobaciones y el estado de procesos.
 *
 * Invariante: está FUERA de toda raíz autorizada y la capa de rutas lo excluye
 * explícitamente, de modo que ninguna herramienta MCP puede leerlo ni escribirlo.
 * Se puede reubicar con JERICHO_CONTROL_DIR (sólo lo cambia una persona).
 */
const controlDir = process.env.JERICHO_CONTROL_DIR || path.join(dataDir, 'control');

const config = {
  rootDir: rootDir,
  dataDir: dataDir,
  workspaceDir: process.env.CHATGPT_WORKSPACE || path.join(process.env.USERPROFILE || process.env.HOME || rootDir, 'ChatGPT-Workspace'),
  tunnelId: process.env.CONTROL_PLANE_TUNNEL_ID || '',
  apiKey: process.env.CONTROL_PLANE_API_KEY || '',
  defaultTimeoutMs: parseInt(process.env.DEFAULT_TIMEOUT_MS, 10) || 60000,
  maxOutputChars: parseInt(process.env.MAX_OUTPUT_CHARS, 10) || 30000,
  logLevel: process.env.LOG_LEVEL || 'INFO',
  enableGridOverlay: process.env.ENABLE_GRID_OVERLAY === 'true' || false,

  // --- Jericho v2 ---
  controlDir: controlDir,
  policyFile: process.env.JERICHO_POLICY_FILE || path.join(controlDir, 'policy.json'),
  journalDir: path.join(controlDir, 'journal'),
  approvalsDir: path.join(controlDir, 'approvals'),
  processStateFile: path.join(controlDir, 'processes.json'),
  /** Memoria v2. Vive junto al workspace pero con su propio directorio versionado. */
  memoryDir: process.env.JERICHO_MEMORY_DIR || path.join(dataDir, 'memory'),
  serverName: 'jericho',
  serverVersion: require('../package.json').version,
};

// Asegurar que existan los directorios clave
for (const dir of [config.dataDir, config.workspaceDir, config.controlDir, config.memoryDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = config;
