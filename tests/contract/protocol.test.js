'use strict';

/**
 * Compatibilidad de protocolo MCP contra el servidor REAL por stdio.
 *
 * Se usa un cliente JSON-RPC mínimo en vez del SDK para poder fijar a mano la
 * `protocolVersion` y comprobar el comportamiento con clientes antiguos.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const h = require('../harness');
const { loadPolicy } = require('../../src/core/policy/loader');
const { SessionAuthority } = require('../../src/core/session/authority');

const SERVER = path.resolve(__dirname, '../../src/index.js');

/** Cliente JSON-RPC mínimo sobre stdio. */
class RawClient {
  constructor(env) {
    this.child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.buffer = '';
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = '';
    this.child.stdout.on('data', (chunk) => this._onData(chunk));
    this.child.stderr.on('data', (c) => {
      this.stderr += c.toString();
    });
  }

  _onData(chunk) {
    this.buffer += chunk.toString();
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        continue;
      }
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        p(msg);
      }
    }
  }

  send(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout en ${method}. stderr:\n${this.stderr.slice(-800)}`)), 30000);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async initialize(protocolVersion, clientName = 'prueba') {
    const res = await this.send('initialize', {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: clientName, version: '1.0.0' },
    });
    this.notify('notifications/initialized', {});
    await new Promise((r) => setTimeout(r, 150));
    return res;
  }

  close() {
    try {
      this.child.kill();
    } catch (e) { /* ignorado */ }
  }
}

function sandboxEnv() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jericho-proto-'));
  const secret = 'protocol-test-session-secret';
  const env = {
      CHATGPT_WORKSPACE: path.join(base, 'ws'),
      JERICHO_CONTROL_DIR: path.join(base, 'control'),
      JERICHO_MEMORY_DIR: path.join(base, 'memory'),
      JERICHO_POLICY_FILE: path.join(base, 'control', 'policy.json'),
      JERICHO_SESSION_AUTH_SECRET: secret,
      LOG_LEVEL: 'ERROR',
    };
  const { policy } = loadPolicy({ policyFile: env.JERICHO_POLICY_FILE, env });
  const revision = crypto.createHash('sha256').update(JSON.stringify(policy)).digest('hex');
  env.JERICHO_MCP_SESSION_TOKEN = new SessionAuthority({ secret, policyRevision: revision }).issue({
    session_id: 'protocol-session', user_id: 'protocol-user', project_id: 'demo', permissions: ['read'], profile: 'core_read',
  });
  return {
    dir: base,
    env,
  };
}

async function run() {
  h.suite('protocolo :: cliente moderno (2025-11-25)');

  const s1 = sandboxEnv();
  const moderno = new RawClient(s1.env);
  try {
    const init = await moderno.initialize('2025-11-25', 'cliente-moderno');
    await h.test('negocia la versión solicitada', () => {
      h.equal(init.result.protocolVersion, '2025-11-25');
    });

    await h.test('declara capacidades de tools, resources y prompts', () => {
      const c = init.result.capabilities;
      h.ok(c.tools, 'faltan tools');
      h.ok(c.resources, 'faltan resources');
      h.ok(c.prompts, 'faltan prompts');
    });

    await h.test('envía instrucciones de servidor con la regla de contenido no fiable', () => {
      h.includes(init.result.instructions, 'DATO NO FIABLE');
    });

    let tools;
    await h.test('tools/list incluye outputSchema y annotations', async () => {
      const res = await moderno.send('tools/list', {});
      tools = res.result.tools;
      h.ok(tools.length >= 10, `sólo ${tools.length} herramientas`);
      for (const t of tools) {
        h.ok(t.outputSchema, `${t.name} sin outputSchema`);
        h.ok(t.annotations, `${t.name} sin annotations`);
        h.equal(t.inputSchema.additionalProperties, false, `${t.name} con esquema abierto`);
      }
    });

    await h.test('tools/call devuelve structuredContent conforme al outputSchema', async () => {
      const res = await moderno.send('tools/call', { name: 'jericho.status', arguments: {} });
      h.ok(res.result.structuredContent, 'no hay structuredContent');
      h.equal(res.result.structuredContent.ok, true);
      h.ok(res.result.structuredContent.trace_id, 'no hay trace_id');
    });

    await h.test('un error de política también devuelve structuredContent tipado', async () => {
      const res = await moderno.send('tools/call', {
        name: 'workspace.read',
        arguments: { paths: ['../../../etc/passwd'] },
      });
      h.equal(res.result.isError, false, 'la lectura de un archivo devuelve errores por archivo');
      h.equal(res.result.structuredContent.files[0].error, 'PATH_OUTSIDE_ROOT');
    });

    await h.test('resources/list funciona', async () => {
      const res = await moderno.send('resources/list', {});
      h.ok(res.result.resources.length >= 5, `sólo ${res.result.resources.length} recursos`);
      h.includes(JSON.stringify(res.result.resources), 'jericho://policy');
    });

    await h.test('resources/read devuelve la política', async () => {
      const res = await moderno.send('resources/read', { uri: 'jericho://policy' });
      const texto = res.result.contents[0].text;
      h.includes(texto, 'max_risk');
      h.includes(texto, 'enabled_tools');
    });

    await h.test('resources/templates/list declara las plantillas de work item', async () => {
      const res = await moderno.send('resources/templates/list', {});
      h.includes(JSON.stringify(res.result.resourceTemplates), '{project_id}');
    });

    await h.test('prompts/list y prompts/get funcionan', async () => {
      const lista = await moderno.send('prompts/list', {});
      h.ok(lista.result.prompts.length >= 4);
      const p = await moderno.send('prompts/get', {
        name: 'reanudar-trabajo',
        arguments: { project_id: 'demo' },
      });
      h.includes(p.result.messages[0].content.text, 'memory.resume');
    });

    await h.test('una herramienta desconocida devuelve error tipado, no una excepción', async () => {
      const res = await moderno.send('tools/call', { name: 'no_existe_esta_herramienta', arguments: {} });
      h.equal(res.result.isError, true);
      h.equal(res.result.structuredContent.error, 'NOT_FOUND');
    });

    await h.test('un nombre de herramienta v1 explica la migración', async () => {
      const res = await moderno.send('tools/call', { name: 'run_command', arguments: { command: 'dir' } });
      h.equal(res.result.isError, true);
      h.ok(res.result.content[0].text.length > 0);
    });
  } finally {
    moderno.close();
  }

  h.suite('protocolo :: cliente antiguo (2024-11-05)');

  const s2 = sandboxEnv();
  const antiguo = new RawClient(s2.env);
  try {
    const init = await antiguo.initialize('2024-11-05', 'cliente-antiguo');

    await h.test('negocia la versión antigua que pidió el cliente', () => {
      h.equal(init.result.protocolVersion, '2024-11-05');
    });

    await h.test('a un cliente antiguo NO se le envía outputSchema', async () => {
      const res = await antiguo.send('tools/list', {});
      for (const t of res.result.tools) {
        h.equal(t.outputSchema, undefined, `${t.name} envía outputSchema a un cliente antiguo`);
      }
    });

    await h.test('la descripción incorpora versión y riesgo para el cliente antiguo', async () => {
      const res = await antiguo.send('tools/list', {});
      h.includes(res.result.tools[0].description, '[Jericho 2.0.0 · riesgo R');
    });

    await h.test('a un cliente antiguo NO se le envía structuredContent', async () => {
      const res = await antiguo.send('tools/call', { name: 'jericho.status', arguments: {} });
      h.equal(res.result.structuredContent, undefined, 'se envió structuredContent a un cliente antiguo');
      h.ok(res.result.content[0].text.length > 50, 'el contenido textual está vacío');
    });

    await h.test('el resultado textual sigue siendo legible y completo', async () => {
      const res = await antiguo.send('tools/call', { name: 'jericho.status', arguments: {} });
      h.includes(res.result.content[0].text, 'raíces de archivos autorizadas');
      h.includes(res.result.content[0].text, 'DATO NO FIABLE');
    });

    await h.test('los errores llegan como texto explicativo', async () => {
      const res = await antiguo.send('tools/call', {
        name: 'terminal.exec',
        arguments: { action: 'run', program: 'cmd', args: [], cwd: '.' },
      });
      h.equal(res.result.isError, true);
      h.includes(res.result.content[0].text, 'COMMAND_NOT_ALLOWED');
    });
  } finally {
    antiguo.close();
  }

  h.suite('protocolo :: versión no soportada');

  const s3 = sandboxEnv();
  const raro = new RawClient(s3.env);
  try {
    const init = await raro.initialize('1999-01-01', 'cliente-raro');
    await h.test('una versión desconocida cae a la más reciente soportada', () => {
      h.equal(init.result.protocolVersion, '2025-11-25');
    });
  } finally {
    raro.close();
  }

  for (const s of [s1, s2, s3]) {
    try {
      fs.rmSync(s.dir, { recursive: true, force: true });
    } catch (e) { /* Windows puede retener handles */ }
  }
}

if (require.main === module) {
  run().then(() => h.exitWithSummary('CONTRATO :: PROTOCOLO MCP'));
}
module.exports = { run };
