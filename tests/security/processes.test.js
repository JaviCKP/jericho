'use strict';

/**
 * Procesos: propiedad, huérfanos, reutilización de PID, TTL y límites.
 *
 * Cubre P1-1: el Map en memoria se perdía al reiniciar, los ids se reutilizaban
 * y se mataba por PID sin comprobar identidad.
 */

const fs = require('fs');
const h = require('../harness');
const { makeSandbox } = require('../helpers/sandbox');
const { Dispatcher } = require('../../src/tools/dispatch');
const { IMPLEMENTATIONS } = require('../../src/tools');
const { ProcessRegistry } = require('../../src/core/exec/registry');
const { writeJsonAtomic } = require('../../src/core/atomic');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const sb = makeSandbox();
  const d = new Dispatcher(sb.runtime, IMPLEMENTATIONS);
  const A = { session_id: 'ses_proc_A' };
  const B = { session_id: 'ses_proc_B' };

  try {
    h.suite('procesos :: identidad y propiedad');

    let procId;
    await h.test('start_background devuelve un proc_id con marca temporal (no un contador)', async () => {
      const r = await d.call('terminal.exec', {
        action: 'start_background',
        program: 'node',
        args: ['-e', 'setInterval(()=>console.log("tick"),200)'],
        cwd: '.',
        ttl_ms: 20000,
        ...A,
      });
      h.equal(r.structuredContent.ok, true, r.structuredContent.message);
      procId = r.structuredContent.proc_id;
      h.ok(/^proc_[a-z0-9]+_[0-9a-f]{12}$/.test(procId), `formato inesperado: ${procId}`);
    });

    await h.test('la lista sólo muestra procesos creados por GhostPC', async () => {
      const r = await d.call('terminal.exec', { action: 'list', ...A });
      h.equal(r.structuredContent.ok, true);
      h.equal(r.structuredContent.processes.length, 1);
      h.equal(r.structuredContent.processes[0].proc_id, procId);
    });

    await h.test('otra sesión NO ve ni puede detener el proceso ajeno', async () => {
      const lista = await d.call('terminal.exec', { action: 'list', ...B });
      h.equal(lista.structuredContent.processes.length, 0);
      const kill = await d.call('terminal.exec', { action: 'stop', proc_id: procId, ...B });
      h.deniedWith(kill, 'PROCESS_NOT_OWNED');
    });

    await h.test('no se puede detener un proceso que GhostPC no creó', async () => {
      const r = await d.call('terminal.exec', { action: 'stop', proc_id: 'proc_inventado_aaaaaaaaaaaa', ...A });
      h.deniedWith(r, 'NOT_FOUND');
    });

    await h.test('no existe ninguna herramienta para matar un PID arbitrario', () => {
      const names = d.listTools().map((t) => t.name);
      h.excludes(JSON.stringify(names), 'kill_process');
      const schema = d.listTools().find((t) => t.name === 'terminal.exec').inputSchema;
      h.equal(schema.properties.pid, undefined, 'terminal.exec acepta un pid arbitrario');
    });

    await h.test('los logs llegan y van redactados', async () => {
      await sleep(500);
      const r = await d.call('terminal.exec', { action: 'logs', proc_id: procId, ...A });
      h.equal(r.structuredContent.ok, true, r.structuredContent.message);
      h.ok(r.structuredContent.lines.length > 0, 'no se capturó salida');
      h.includes(JSON.stringify(r.structuredContent.lines), 'tick');
    });

    await h.test('stop detiene el proceso propio', async () => {
      const r = await d.call('terminal.exec', { action: 'stop', proc_id: procId, ...A });
      h.equal(r.structuredContent.ok, true, r.structuredContent.message);
      h.equal(r.structuredContent.killed, true);
      await sleep(300);
      const rec = sb.runtime.registry.live.get(procId);
      h.notEqual(rec.status, 'RUNNING');
    });

    h.suite('procesos :: reutilización de PID');

    await h.test('si el PID fue reutilizado, NO se envía ninguna señal', async () => {
      const r = await d.call('terminal.exec', {
        action: 'start_background', program: 'node', args: ['-e', 'setTimeout(()=>{},30000)'], cwd: '.', ...A,
      });
      const id = r.structuredContent.proc_id;
      // Se simula que el sistema reasignó ese PID a otro proceso distinto.
      const rec = sb.runtime.registry.live.get(id);
      rec.os_start_time = '1999-01-01T00:00:00.0000000Z';

      const kill = await d.call('terminal.exec', { action: 'stop', proc_id: id, ...A });
      h.deniedWith(kill, 'PROCESS_NOT_OWNED');
      h.includes(kill.structuredContent.message, 'reutilizado');

      // El proceso real sigue vivo: se limpia por la vía normal.
      rec.os_start_time = ProcessRegistry.processStartTime(rec.pid);
      await d.call('terminal.exec', { action: 'stop', proc_id: id, ...A });
    });

    h.suite('procesos :: huérfanos tras una caída');

    await h.test('recoverOrphans encuentra y mata los procesos de la ejecución anterior', async () => {
      // Se lanza un proceso real y se simula una caída del servidor escribiendo
      // el estado a disco y creando un registro nuevo desde cero.
      const r = await d.call('terminal.exec', {
        action: 'start_background', program: 'node', args: ['-e', 'setTimeout(()=>{},60000)'], cwd: '.', ...A,
      });
      const id = r.structuredContent.proc_id;
      const rec = sb.runtime.registry.live.get(id);
      const pid = rec.pid;
      h.equal(ProcessRegistry.isAlive(pid), true, 'el proceso de prueba no arrancó');

      // "Caída": nuevo registro que sólo conoce el estado persistido.
      const nuevo = new ProcessRegistry(sb.runtime.paths.processStateFile, { journal: sb.runtime.journal });
      const res = await nuevo.recoverOrphans({ kill: true });
      h.ok(res.recovered >= 1, `no se detectó ningún huérfano (${JSON.stringify(res)})`);
      h.ok(res.killed >= 1, 'no se mató ningún huérfano');
      await sleep(500);
      h.equal(ProcessRegistry.isAlive(pid), false, 'el huérfano sigue vivo');
      // El registro original ya no debe considerar vivo ese proceso.
      sb.runtime.registry.live.clear();
    });

    await h.test('un huérfano NO verificable no se mata (podría ser un PID reutilizado)', async () => {
      const stateFile = sb.runtime.paths.processStateFile;
      writeJsonAtomic(stateFile, {
        updated_at: new Date().toISOString(),
        processes: [
          {
            proc_id: 'proc_falso_000000000000',
            pid: process.pid, // este proceso (la suite) está vivo
            program: 'node',
            status: 'RUNNING',
            os_start_time: '1999-01-01T00:00:00.0000000Z', // no coincide
          },
        ],
      });
      const nuevo = new ProcessRegistry(stateFile, { journal: sb.runtime.journal });
      const res = await nuevo.recoverOrphans({ kill: true });
      h.equal(res.killed, 0, 'se mató un proceso que no se pudo verificar');
      h.equal(res.unverifiable, 1);
      h.equal(ProcessRegistry.isAlive(process.pid), true, 'la propia suite fue eliminada');
    });

    h.suite('procesos :: límites');

    await h.test('el TTL caduca y el barrido lo detiene', async () => {
      const r = await d.call('terminal.exec', {
        action: 'start_background', program: 'node', args: ['-e', 'setTimeout(()=>{},60000)'], cwd: '.', ttl_ms: 1000, ...A,
      });
      const id = r.structuredContent.proc_id;
      const pid = sb.runtime.registry.live.get(id).pid;
      await sleep(1300);
      const matados = await sb.runtime.registry.sweepExpired();
      h.includes(JSON.stringify(matados), id);
      await sleep(400);
      h.equal(ProcessRegistry.isAlive(pid), false, 'el proceso caducado sigue vivo');
    });

    await h.test('se respeta el límite de procesos en segundo plano', async () => {
      const ids = [];
      let denied = null;
      for (let i = 0; i < sb.runtime.policy.limits.exec.max_background + 2; i++) {
        const r = await d.call('terminal.exec', {
          action: 'start_background', program: 'node', args: ['-e', 'setTimeout(()=>{},20000)'], cwd: '.', ...A,
        });
        if (r.isError) {
          denied = r;
          break;
        }
        ids.push(r.structuredContent.proc_id);
      }
      h.ok(denied, 'no se aplicó el límite de procesos en segundo plano');
      h.equal(denied.structuredContent.error, 'LIMIT_EXCEEDED');
      for (const id of ids) await d.call('terminal.exec', { action: 'stop', proc_id: id, ...A });
    });

    await h.test('un timeout mata el proceso y lo reporta', async () => {
      const r = await d.call('terminal.exec', {
        action: 'run', program: 'node', args: ['-e', 'setTimeout(()=>{},30000)'], cwd: '.', timeout_ms: 1200, ...A,
      });
      h.equal(r.structuredContent.timed_out, true, 'no se reportó el timeout');
    });

    await h.test('la salida se corta al superar el límite de bytes', async () => {
      const r = await d.call('terminal.exec', {
        action: 'run',
        program: 'node',
        args: ['-e', 'for(let i=0;i<200000;i++) console.log("x".repeat(80))'],
        cwd: '.',
        timeout_ms: 30000,
        ...A,
      });
      h.equal(r.structuredContent.truncated, true, 'no se truncó la salida');
      h.ok(
        r.structuredContent.stdout.length <= sb.runtime.policy.limits.exec.max_output_bytes,
        'la salida supera el límite configurado'
      );
    });

    await h.test('cwd es obligatorio', async () => {
      const r = await d.call('terminal.exec', { action: 'run', program: 'node', args: ['-v'], ...A });
      h.deniedWith(r, 'INVALID_ARGUMENT');
      h.includes(r.structuredContent.message, 'cwd');
    });

    await h.test('cwd fuera de la raíz -> denegado', async () => {
      const r = await d.call('terminal.exec', { action: 'run', program: 'node', args: ['-v'], cwd: '../..', ...A });
      h.equal(r.isError, true);
      h.ok(['PATH_OUTSIDE_ROOT', 'PATH_DENIED'].includes(r.structuredContent.error), r.structuredContent.error);
    });
  } finally {
    try {
      await sb.runtime.registry.killAll('fin de pruebas');
    } catch (e) { /* mejor esfuerzo */ }
    sb.cleanup();
  }
}

if (require.main === module) {
  run().then(() => h.exitWithSummary('SEGURIDAD :: PROCESOS'));
}
module.exports = { run };
