'use strict';
const h = require('../harness');
const { makeSandbox } = require('../helpers/sandbox');
const { Dispatcher } = require('../../src/tools/dispatch');
const { IMPLEMENTATIONS } = require('../../src/tools');
const { ProcessRegistry } = require('../../src/core/exec/registry');
const { writeJsonAtomic } = require('../../src/core/atomic');

async function run() {
  const sb = makeSandbox();
  const d = new Dispatcher(sb.runtime, IMPLEMENTATIONS);
  const A = { session_id: 'ses_proc_A' };
  const B = { session_id: 'ses_proc_B' };
  try {
    h.suite('procesos :: contrato fail-closed y propiedad');
    await h.test('start_background genérico queda bloqueado', async () => {
      const r = await d.call('terminal.exec', { action: 'start_background', program: 'node', args: ['--eval', 'x'], cwd: '.', ...A });
      h.deniedWith(r, 'COMMAND_NOT_ALLOWED');
    });
    await h.test('run genérico y verify de scripts quedan bloqueados', async () => {
      const r = await d.call('terminal.exec', { action: 'run', program: 'python', args: ['-m', 'pip'], cwd: '.', ...A });
      h.deniedWith(r, 'COMMAND_NOT_ALLOWED');
      const v = await d.call('verify.run', { check: 'custom', program: 'npm', args: ['run', 'test'], cwd: '.', ...A });
      h.deniedWith(v, 'COMMAND_NOT_ALLOWED');
    });
    await h.test('la lista no muestra procesos no creados', async () => {
      const r = await d.call('terminal.exec', { action: 'list', ...A });
      h.equal(r.structuredContent.processes.length, 0);
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
