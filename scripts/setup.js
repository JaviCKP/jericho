#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const binDir = path.join(rootDir, 'bin');
const binaryExe = process.platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client';
const binaryPath = path.join(binDir, binaryExe);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question, defaultValue = '') {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function main() {
  console.log('\n================================================================');
  console.log('   🚀 OPENPC-MCP SUITE - ASISTENTE DE CONFIGURACIÓN RÁPIDA      ');
  console.log('================================================================\n');
  console.log('Este asistente configurará la conexión entre ChatGPT Web (chatgpt.com)');
  console.log('y tu ordenador con visión, terminal, filesystem y control total.\n');

  // 1. Comprobar binario
  if (!fs.existsSync(binaryPath)) {
    console.log('📦 Binario de túnel no detectado. Descargando automáticamente...');
    try {
      execSync('node scripts/download-binaries.js', { cwd: rootDir, stdio: 'inherit' });
    } catch (e) {
      console.error('❌ Error descargando binarios. Continuando de forma manual.');
    }
  } else {
    console.log('✅ Binario tunnel-client detectado.');
  }

  // 2. Leer valores existentes si existen
  let existingTunnelId = '';
  let existingApiKey = '';

  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const tMatch = envContent.match(/CONTROL_PLANE_TUNNEL_ID=(.*)/);
    const kMatch = envContent.match(/CONTROL_PLANE_API_KEY=(.*)/);
    if (tMatch) existingTunnelId = tMatch[1].trim();
    if (kMatch) existingApiKey = kMatch[1].trim();
  }

  console.log('\n--- PASO 1: Identificador de Túnel (Tunnel ID) ---');
  console.log('👉 Ve a: https://platform.openai.com/settings/organization/tunnels');
  console.log('Crea un túnel y copia el identificador (ej: tunnel_0123456789abcdef...).');
  const tunnelId = await ask('Introduce tu CONTROL_PLANE_TUNNEL_ID', existingTunnelId);

  console.log('\n--- PASO 2: Clave API de OpenAI Platform ---');
  console.log('👉 Ve a: https://platform.openai.com/settings/organization/api-keys');
  console.log('Crea una clave secreta (Runtime Key) con permisos Tunnels (Read + Use).');
  const apiKey = await ask('Introduce tu CONTROL_PLANE_API_KEY', existingApiKey);

  console.log('\n--- PASO 3: Carpeta de Trabajo (Workspace) ---');
  const defaultWorkspace = path.join(process.env.USERPROFILE || process.env.HOME || rootDir, 'ChatGPT-Workspace');
  const workspaceDir = await ask('Ruta para la carpeta de trabajo de ChatGPT', defaultWorkspace);

  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
    console.log(`✅ Carpeta de trabajo creada en: ${workspaceDir}`);
  }

  // 3. Guardar .env
  const envContent = [
    `# ===================================================================`,
    `# OPENPC-MCP SUITE CONFIGURATION`,
    `# ===================================================================`,
    `CONTROL_PLANE_TUNNEL_ID=${tunnelId}`,
    `CONTROL_PLANE_API_KEY=${apiKey}`,
    `CHATGPT_WORKSPACE=${workspaceDir}`,
    `LOG_LEVEL=INFO`,
    `DEFAULT_TIMEOUT_MS=60000`,
    `ENABLE_GRID_OVERLAY=false`,
  ].join('\n');

  fs.writeFileSync(envPath, envContent, 'utf-8');
  fs.writeFileSync(path.join(rootDir, 'config.env'), envContent, 'utf-8');
  console.log('\n✅ Archivo de configuración .env guardado con éxito.');

  // 4. Configurar perfil YAML de tunnel-client
  const indexPath = path.join(rootDir, 'src', 'index.js').replace(/\\/g, '/');
  const mcpCommand = `node ${indexPath}`;

  console.log('\n--- PASO 4: Inicializando perfil de túnel en OpenAI tunnel-client ---');
  try {
    const initCmd = `"${binaryPath}" init --profile openpc-mcp --tunnel-id ${tunnelId} --mcp-command "${mcpCommand}" --force`;
    execSync(initCmd, { cwd: rootDir, stdio: 'inherit' });
    console.log('✅ Perfil openpc-mcp generado correctamente.');
  } catch (e) {
    console.warn('⚠️ Nota sobre inicialización de perfil:', e.message);
  }

  // 5. Validar con doctor
  console.log('\n--- PASO 5: Verificando conectividad con OpenAI ---');
  try {
    process.env.CONTROL_PLANE_API_KEY = apiKey;
    execSync(`"${binaryPath}" doctor --profile openpc-mcp --explain`, {
      cwd: rootDir,
      stdio: 'inherit',
      env: { ...process.env, CONTROL_PLANE_API_KEY: apiKey },
    });
  } catch (e) {
    console.warn('⚠️ Doctor reportó alguna advertencia o comprobación omitida.');
  }

  console.log('\n================================================================');
  console.log('🎉 ¡CONFIGURACIÓN COMPLETADA CON ÉXITO!');
  console.log('================================================================');
  console.log('\n¿Cómo empezar a usarlo?');
  console.log('1. Para ejecutar en consola visible:   scripts/start.bat  (o npm start)');
  console.log('2. Para ejecutar 100% invisible:      scripts/start-silent.vbs');
  console.log('3. Para auto-iniciar con Windows:     scripts/install-autostart.bat');
  console.log('\nEn ChatGPT Web (chatgpt.com/#settings/Connectors):');
  console.log(`- Añade una app tipo "Tunnel" y selecciona tu ID: ${tunnelId}`);
  console.log('================================================================\n');

  rl.close();
}

main().catch((err) => {
  console.error('Error fatal durante la configuración:', err);
  rl.close();
});
