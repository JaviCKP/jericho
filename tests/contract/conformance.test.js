'use strict';

/**
 * Conformidad de salida: se ejercita CADA herramienta y se comprueba que su
 * respuesta real (éxito o error) cumple su outputSchema declarado.
 *
 * El propio dispatcher ya valida la salida y convierte un incumplimiento en
 * INTERNAL, así que esta suite detecta tanto esquemas mal declarados como
 * implementaciones que devuelven campos que no encajan.
 */

const fs = require('fs');
const path = require('path');
const h = require('../harness');
const { makeSandbox } = require('../helpers/sandbox');
const { Dispatcher } = require('../../src/tools/dispatch');
const { IMPLEMENTATIONS } = require('../../src/tools');
const { BY_NAME, ALL_TOOLS } = require('../../src/tools/catalog');
const { checkOutput } = require('../../src/tools/validate');

/** Llamadas representativas por herramienta (válidas e inválidas). */
function casos(sb) {
  const S = { session_id: 'ses_conf' };
  return {
    'ghostpc.status': [{}, { include: ['policy', 'metrics', 'approvals', 'processes', 'recent_activity'] }, { include: ['inventado'] }],
    'workspace.inspect': [{ action: 'roots' }, { action: 'tree', path: '.' }, { action: 'stat', path: 'a.txt' }, { action: 'stat', path: 'no-existe' }],
    'workspace.search': [{ mode: 'files', pattern: '**/*.txt' }, { mode: 'content', pattern: 'hola' }, { mode: 'content', pattern: '[', is_regex: true }],
    'workspace.read': [{ paths: ['a.txt'] }, { paths: ['no-existe.txt'] }, { paths: ['../fuera'] }],
    'memory.resume': [
      { action: 'list_projects' },
      { action: 'rules' },
      { action: 'list_items', project_id: 'conf' },
      { action: 'load', project_id: 'conf', id: 'w1' },
      { action: 'history', project_id: 'conf', id: 'w1' },
      { action: 'load', project_id: 'conf', id: 'no-existe' },
    ],
    'git.inspect': [{ action: 'status', path: '.' }, { action: 'log', path: '.' }],
    'workspace.apply_patch': [
      { patch: '--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,1 @@\n-hola\n+HOLA\n', dry_run: true },
      { patch: 'no es un diff' },
    ],
    'workspace.rollback': [{ rollback_token: 'rb_inexistente' }],
    'terminal.exec': [
      { action: 'list' },
      { action: 'run', program: 'node', args: ['-e', 'console.log(1)'], cwd: '.' },
      { action: 'run', program: 'node', args: ['-e', 'process.exit(3)'], cwd: '.' },
      { action: 'run', program: 'node', args: ['-v'], cwd: '.', dry_run: true },
      { action: 'run', program: 'prohibido', args: [], cwd: '.' },
      { action: 'logs', proc_id: 'proc_inexistente_aaaa' },
    ],
    'verify.run': [{ check: 'test', cwd: '.' }, { check: 'custom', program: 'node', args: ['-v'], cwd: '.' }],
    'memory.checkpoint': [
      { action: 'create', project_id: 'conf2', id: 'w2', title: 'T' },
      { action: 'update', project_id: 'conf2', id: 'w2', expected_revision: 1, next_action: 'x' },
      { action: 'update', project_id: 'conf2', id: 'w2', expected_revision: 99, next_action: 'x' },
      { action: 'record_decision', project_id: 'conf2', decision: { title: 'D', decision: 'hacerlo' } },
      { action: 'compact', project_id: 'conf2' },
      { action: 'restore', project_id: 'conf2', id: 'w2', revision: 1 },
    ],
    'memory.propose_rule': [{ text: 'Una regla de prueba suficientemente larga' }],
    'git.commit': [{ action: 'commit', path: '.', message: 'x', files: ['a.txt'], dry_run: true }, { action: 'commit', path: '.', message: 'x' }],
    // Perfiles no activos en este sandbox: se comprueba el error de perfil.
    'desktop.observe': [{ action: 'windows' }],
    'desktop.element_action': [{ action: 'click', window_id: 1, x: 1, y: 1 }],
    'desktop.keyboard': [{ action: 'type', window_id: 1, text: 'x' }],
    'web.fetch_readonly': [{ url: 'https://example.com/' }],
    'http.call_allowlisted': [{ destination: 'npm', path: '/' }],
    'admin.perform_allowlisted_action': [{ action_id: 'algo' }],
  };
}

async function run() {
  const sb = makeSandbox();
  const d = new Dispatcher(sb.runtime, IMPLEMENTATIONS);
  sb.write('a.txt', 'hola\n');

  // Datos previos para que memory.resume tenga algo que cargar.
  await d.call('memory.checkpoint', { action: 'create', project_id: 'conf', id: 'w1', title: 'W1', session_id: 'ses_conf' });

  try {
    const todos = casos(sb);

    for (const def of ALL_TOOLS) {
      const lista = todos[def.name];
      await h.test(`${def.name}: hay casos de conformidad definidos`, () => {
        h.ok(Array.isArray(lista) && lista.length > 0, `sin casos para ${def.name}`);
      });
      if (!lista) continue;

      for (let i = 0; i < lista.length; i++) {
        const args = { session_id: 'ses_conf', ...lista[i] };
        await h.test(`${def.name}[${i}] cumple su outputSchema`, async () => {
          const r = await d.call(def.name, args);
          h.ok(r.structuredContent, 'no hay structuredContent');
          const errores = checkOutput(def.outputSchema, r.structuredContent);
          h.equal(errores.length, 0, `salida no conforme: ${errores.join('; ')}`);
          h.equal(typeof r.structuredContent.ok, 'boolean');
          h.ok(r.structuredContent.trace_id, 'falta trace_id');
          if (r.structuredContent.ok === false) {
            h.ok(r.structuredContent.error, 'un error sin código');
            h.ok(r.structuredContent.message, 'un error sin mensaje');
            h.equal(typeof r.structuredContent.recoverable, 'boolean', 'un error sin recoverable');
          }
          // La respuesta textual nunca puede ir vacía.
          h.ok(r.content && r.content[0] && r.content[0].text.length > 0, 'contenido textual vacío');
        });
      }
    }

    h.suite('conformidad :: propiedades transversales');

    await h.test('todo error devuelve un código del catálogo de errores', async () => {
      const { CODES } = require('../../src/core/errors');
      const conocidos = new Set(Object.values(CODES));
      const errores = sb.runtime.journal.readAll().filter((e) => e.kind === 'tool.error');
      for (const e of errores) {
        h.ok(conocidos.has(e.error), `código desconocido: ${e.error}`);
      }
    });

    await h.test('toda llamada quedó registrada en el diario con trace_id', () => {
      const entries = sb.runtime.journal.readAll().filter((e) => ['tool.call', 'tool.error'].includes(e.kind));
      h.ok(entries.length > 20, `sólo ${entries.length} entradas`);
      h.equal(entries.filter((e) => !e.trace_id).length, 0, 'hay entradas sin trace_id');
    });

    await h.test('la cadena de hashes del diario sigue íntegra tras todas las llamadas', () => {
      const v = sb.runtime.journal.verify();
      h.equal(v.valid, true, `cadena rota en ${v.brokenAt}: ${v.reason}`);
    });

    await h.test('las herramientas de perfiles inactivos devuelven PROFILE_DISABLED', async () => {
      for (const name of ['desktop.observe', 'web.fetch_readonly', 'admin.perform_allowlisted_action']) {
        const r = await d.call(name, { ...casos(sb)[name][0], session_id: 'ses_conf' });
        h.equal(r.structuredContent.error, 'PROFILE_DISABLED', `${name} no está protegida por perfil`);
      }
    });
  } finally {
    sb.cleanup();
  }
}

if (require.main === module) {
  run().then(() => h.exitWithSummary('CONTRATO :: CONFORMIDAD DE SALIDA'));
}
module.exports = { run };
