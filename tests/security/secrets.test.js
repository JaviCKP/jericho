'use strict';

/**
 * Fuga de secretos.
 *
 * En v1, `get_environment_vars` enmascaraba por nombre pero `read_file` sobre
 * .env y `run_command` con `echo %VAR%` devolvían el valor real (P0-2, P0-3).
 */

const fs = require('fs');
const path = require('path');
const h = require('../harness');
const { makeSandbox } = require('../helpers/sandbox');
const { Dispatcher } = require('../../src/tools/dispatch');
const { IMPLEMENTATIONS } = require('../../src/tools');
const redact = require('../../src/core/redact');

const SECRET = 'sk-proj-VALORSECRETOREALDEPRUEBA1234567890';
const TOKEN = 'ghp_TOKENDEPRUEBAaaaaaaaaaaaaaaaaaaaaaaaa';

async function run() {
  const sb = makeSandbox({
    env: {
      CONTROL_PLANE_API_KEY: SECRET,
      GITHUB_TOKEN: TOKEN,
      JERICHO_SESSION_AUTH_SECRET: 'synthetic-session-authority-secret',
    },
    policy: {
      schema_version: 1,
      profiles: ['core_read', 'development'],
      secrets: { allowed: ['GITHUB_TOKEN'], never_return_values: true },
    },
  });
  const d = new Dispatcher(sb.runtime, IMPLEMENTATIONS);
  const S = { session_id: 'ses_secrets' };
  const sessionToken = sb.runtime.sessionAuthority.issue({
    session_id: 'ses_secrets', user_id: 'user_secrets', project_id: 'project_secrets',
    permissions: ['read', 'execute'], profile: 'development',
  });
  const AUTH = { sessionToken };

  try {
    h.suite('secretos :: no existe herramienta que devuelva el entorno');

    await h.test('get_environment_vars ya no existe', async () => {
      const r = await d.call('get_environment_vars', { names: ['CONTROL_PLANE_API_KEY'] });
      h.deniedWith(r, 'NOT_FOUND');
      h.includes(r.structuredContent.remediation, 'nunca vuelven al modelo');
    });

    await h.test('ninguna herramienta expuesta lee variables de entorno', () => {
      const names = d.listTools().map((t) => t.name);
      h.excludes(JSON.stringify(names), 'environment');
      h.excludes(JSON.stringify(names), 'env_var');
    });

    h.suite('secretos :: archivos con credenciales');

    sb.write('.env', `CONTROL_PLANE_API_KEY=${SECRET}\n`);
    sb.write('config/cert.pem', '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n');

    await h.test('.env dentro de la raíz -> PATH_DENIED', async () => {
      const r = await d.call('workspace.read', { paths: ['.env'], ...S });
      h.equal(r.structuredContent.files[0].error, 'PATH_DENIED');
      h.excludes(JSON.stringify(r), SECRET);
    });

    await h.test('*.pem dentro de la raíz -> PATH_DENIED', async () => {
      const r = await d.call('workspace.read', { paths: ['config/cert.pem'], ...S });
      h.equal(r.structuredContent.files[0].error, 'PATH_DENIED');
    });

    await h.test('el .env del propio servidor está fuera de toda raíz', async () => {
      const r = await d.call('workspace.read', { paths: [path.resolve(__dirname, '../../.env')], ...S });
      h.ok(['PATH_OUTSIDE_ROOT', 'PATH_DENIED'].includes(r.structuredContent.files[0].error), r.structuredContent.files[0].error);
    });

    await h.test('workspace.search no puede hacer grep dentro de .env', async () => {
      const r = await d.call('workspace.search', { mode: 'content', pattern: 'CONTROL_PLANE', ...S });
      h.equal(r.structuredContent.ok, true);
      h.excludes(JSON.stringify(r), SECRET);
    });

    h.suite('secretos :: procesos hijo');

    await h.test('el hijo NO hereda el entorno del servidor', async () => {
      const r = await d.call('terminal.exec', {
        action: 'run',
        program: 'node',
        args: ['-e', 'process.stdout.write(String(process.env.CONTROL_PLANE_API_KEY))'],
        cwd: '.',
        ...S,
      }, AUTH);
      h.equal(r.structuredContent.ok, true);
      h.equal(r.structuredContent.stdout.trim(), 'undefined', 'el hijo heredó el secreto');
      h.excludes(JSON.stringify(r), SECRET);
    });

    await h.test('un secreto NO autorizado no se puede inyectar', async () => {
      const r = await d.call('terminal.exec', {
        action: 'run',
        program: 'node',
        args: ['-e', 'console.log(1)'],
        cwd: '.',
        secret_names: ['CONTROL_PLANE_API_KEY'],
        ...S,
      }, AUTH);
      h.equal(r.structuredContent.ok, false);
      h.ok(['SECRET_NOT_ALLOWED', 'COMMAND_NOT_ALLOWED'].includes(r.structuredContent.error));
      h.excludes(JSON.stringify(r.content), TOKEN);
      h.excludes(JSON.stringify(r.structuredContent), TOKEN);
    });

    await h.test('un secreto autorizado SÍ llega al hijo pero su valor NO vuelve', async () => {
      const r = await d.call('terminal.exec', {
        action: 'run',
        program: 'node',
        args: ['-e', 'process.stdout.write("len=" + String(process.env.GITHUB_TOKEN || "").length)'],
        cwd: '.',
        secret_names: ['GITHUB_TOKEN'],
        ...S,
      }, AUTH);
      h.equal(r.structuredContent.ok, true);
      h.includes(r.structuredContent.stdout, 'len=');
      h.excludes(JSON.stringify(r.content), TOKEN);
      h.excludes(JSON.stringify(r.structuredContent), TOKEN);
      h.excludes(JSON.stringify(r), TOKEN);
    });

    await h.test('si el hijo IMPRIME el secreto, la salida sale redactada', async () => {
      const r = await d.call('terminal.exec', {
        action: 'run',
        program: 'node',
        args: ['-e', 'process.stdout.write(process.env.GITHUB_TOKEN)'],
        cwd: '.',
        secret_names: ['GITHUB_TOKEN'],
        ...S,
      }, AUTH);
      h.equal(r.structuredContent.ok, true);
      h.includes(r.structuredContent.stdout, 'REDACTED');
      h.excludes(JSON.stringify(r.content), TOKEN);
      h.excludes(JSON.stringify(r.structuredContent), TOKEN);
      h.excludes(JSON.stringify(r), TOKEN);
    });

    h.suite('secretos :: el diario nunca guarda valores');

    await h.test('ninguna entrada del diario contiene un secreto', () => {
      const all = JSON.stringify(sb.runtime.journal.readAll());
      h.excludes(all, SECRET);
      h.excludes(all, TOKEN);
    });

    await h.test('el diario SÍ registra qué secreto se usó', () => {
      const authenticated = sb.runtime.sessionAuthority.authenticate(sessionToken);
      sb.runtime.secrets.materializeForProcess(['GITHUB_TOKEN'], {
        ...authenticated,
        tool: 'synthetic.authorized-action',
        trace_id: 'trace_secret_test',
        program: 'fixed-test-action',
      });
      const entries = sb.runtime.journal.readAll().filter((e) => e.kind === 'secret.injected');
      h.ok(entries.length >= 1, 'no se registró ninguna inyección de secreto');
      h.equal(entries[0].secret_name, 'GITHUB_TOKEN');
      h.excludes(JSON.stringify(entries), TOKEN);
    });

    await h.test('SecretBroker.list() devuelve nombres, nunca valores', () => {
      const list = sb.runtime.secrets.list();
      h.equal(list.length, 1);
      h.equal(list[0].name, 'GITHUB_TOKEN');
      h.excludes(JSON.stringify(list), TOKEN);
    });

    h.suite('secretos :: capa de redacción');

    await h.test('redacta valores literales del entorno', () => {
      h.excludes(redact.redactText(`clave=${SECRET}`), SECRET);
    });

    await h.test('redacta variantes base64 del secreto', () => {
      const b64 = Buffer.from(SECRET, 'utf8').toString('base64');
      h.excludes(redact.redactText(`Authorization: Basic ${b64}`), b64);
    });

    await h.test('redacta tokens por forma aunque no los conozca', () => {
      const desconocido = 'ghp_OTROTOKENQUEELSERVIDORNOCONOCE1234567';
      h.includes(redact.redactText(desconocido), 'REDACTED');
    });

    await h.test('redacta claves privadas completas', () => {
      const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----';
      h.includes(redact.redactText(pem), 'REDACTED');
      h.excludes(redact.redactText(pem), 'MIIabc');
    });

    await h.test('redacta credenciales embebidas en URL', () => {
      const url = 'https://usuario:contrasenya123@ejemplo.com/x';
      h.excludes(redact.redactUrl(url), 'contrasenya123');
    });

    await h.test('redacta cabeceras sensibles', () => {
      const out = redact.redactHeaders({ Authorization: 'Bearer abc123', 'Content-Type': 'application/json' });
      h.equal(out['Content-Type'], 'application/json');
      h.excludes(JSON.stringify(out), 'abc123');
    });

    await h.test('la redacción es idempotente', () => {
      const una = redact.redactText(`x=${SECRET}`);
      h.equal(redact.redactText(una), una);
    });

    h.suite('secretos :: cortafuegos final');

    await h.test('assertNoLeak bloquea una respuesta con un secreto', () => {
      let lanzo = false;
      try {
        sb.runtime.secrets.assertNoLeak(`resultado: ${TOKEN}`);
      } catch (e) {
        lanzo = e.code === 'SECRET_VALUE_NEVER_RETURNED';
      }
      h.equal(lanzo, true, 'el cortafuegos no bloqueó la fuga');
    });
  } finally {
    sb.cleanup();
  }
}

if (require.main === module) {
  run().then(() => h.exitWithSummary('SEGURIDAD :: SECRETOS'));
}
module.exports = { run };
