'use strict';
const h = require('../harness');
const { makeSandbox } = require('../helpers/sandbox');
const { Dispatcher } = require('../../src/tools/dispatch');
const { IMPLEMENTATIONS } = require('../../src/tools');
const { ProcessRegistry } = require('../../src/core/exec/registry');
const { writeJsonAtomic } = require('../../src/core/atomic');

async function run() {
  const sb = makeSandbox({ env: { JERICHO_SESSION_AUTH_SECRET: 'proc-test-session-secret' } });
  const d = new Dispatcher(sb.runtime, IMPLEMENTATIONS);
  const A = { session_id: 'ses_proc_A' };
  const B = { session_id: 'ses_proc_B' };
  const rawCall = d.call.bind(d);
  d.call = (name, args = {}) => {
    const sId = args.session_id || 'ses_proc_A';
    const token = sb.runtime.sessionAuthority.issue({
      session_id: sId,
      user_id: `user_${sId}`,
      project_id: `project_${sId}`,
      permissions: ['read', 'write', 'execute'],
      profile: 'development',
    });
    return rawCall(name, args, { sessionToken: token });
  };
  try {
    h.suite('procesos :: contrato fail-closed y propiedad');
    await h.test('programa no en allowlist queda bloqueado', async () => {
      const r = await d.call('terminal.exec', { action: 'start_background', program: 'evil_binary', args: [], cwd: '.', ...A });
      h.deniedWith(r, 'COMMAND_NOT_ALLOWED');
    });
    await h.test('programa permitido arranca y genera proc_id', async () => {
      const r = await d.call('terminal.exec', { action: 'start_background', program: 'node', args: ['-e', 'setTimeout(()=>{}, 2000)'], cwd: '.', ...A });
      h.equal(r.structuredContent.ok, true);
      h.ok(r.structuredContent.proc_id, 'no devolvió proc_id');
      await d.call('terminal.exec', { action: 'stop', proc_id: r.structuredContent.proc_id, ...A });
    });
    await h.test('la lista muestra sólo procesos de la propia sesión', async () => {
      const r = await d.call('terminal.exec', { action: 'list', ...A });
      h.equal(r.structuredContent.ok, true);
      const other = await d.call('terminal.exec', { action: 'list', ...B });
      h.equal(other.structuredContent.processes.length, 0);
    });
    await h.test('logs y stop exigen un proceso Jericho existente', async () => {
      const id = 'proc_inventado_aaaaaaaaaaaa';
      h.deniedWith(await d.call('terminal.exec', { action: 'logs', proc_id: id, ...A }), 'NOT_FOUND');
      h.deniedWith(await d.call('terminal.exec', { action: 'stop', proc_id: id, ...B }), 'NOT_FOUND');
    });
    await h.test('no existe ninguna herramienta para matar un PID arbitrario', () => {
      const names = d.listTools().map((t) => t.name);
      h.excludes(JSON.stringify(names), 'kill_process');
      const schema = d.listTools().find((t) => t.name === 'terminal.exec').inputSchema;
      h.equal(schema.properties.pid, undefined);
    });
    await h.test('un huérfano no verificable no se mata', async () => {
      const stateFile = sb.runtime.paths.processStateFile;
      writeJsonAtomic(stateFile, { updated_at: new Date().toISOString(), processes: [{ proc_id: 'proc_falso_000000000000', pid: process.pid, program: 'node', status: 'RUNNING', os_start_time: '1999-01-01T00:00:00.0000000Z' }] });
      const nuevo = new ProcessRegistry(stateFile, { journal: sb.runtime.journal });
      const res = await nuevo.recoverOrphans({ kill: true });
      h.equal(res.killed, 0);
      h.equal(res.unverifiable, 1);
      h.equal(ProcessRegistry.isAlive(process.pid), true);
    });
  } finally { sb.cleanup(); }
}
if (require.main === module) run().then(() => h.exitWithSummary('SEGURIDAD :: PROCESOS'));
module.exports = { run };
