'use strict';

/** Comprobación rápida de que el runtime arranca y el dispatcher responde. */

const { makeSandbox } = require('./helpers/sandbox');
const { Dispatcher } = require('../src/tools/dispatch');
const { IMPLEMENTATIONS } = require('../src/tools');
const { recover } = require('../src/core/runtime');

(async () => {
  const sb = makeSandbox();
  try {
    const rec = await recover(sb.runtime);
    console.log('recuperación:', JSON.stringify(rec.orphans), 'cadena diario válida:', rec.journal_chain.valid);

    const d = new Dispatcher(sb.runtime, IMPLEMENTATIONS);
    const tools = d.listTools();
    console.log(`herramientas expuestas: ${tools.length} -> ${tools.map((t) => t.name).join(', ')}`);
    console.log('bytes de tools/list:', JSON.stringify({ tools }).length);

    sb.write('hola.txt', 'linea1\nlinea2\n');

    const status = await d.call('ghostpc.status', {});
    console.log('\nghostpc.status ok =', status.structuredContent.ok);

    const read = await d.call('workspace.read', { paths: ['hola.txt'] });
    console.log('workspace.read ok =', read.structuredContent.ok, '| sha256 =', read.structuredContent.files[0].sha256.slice(0, 12));

    const escape = await d.call('workspace.read', { paths: ['../../../Windows/win.ini'] });
    console.log('lectura fuera de raíz ->', escape.structuredContent.files[0].error);

    const patch = [
      '--- a/hola.txt',
      '+++ b/hola.txt',
      '@@ -1,2 +1,2 @@',
      ' linea1',
      '-linea2',
      '+LINEA2-EDITADA',
      '',
    ].join('\n');
    const dry = await d.call('workspace.apply_patch', { patch, dry_run: true });
    console.log('apply_patch dry-run ok =', dry.structuredContent.ok, '| applied =', dry.structuredContent.applied);

    const applied = await d.call('workspace.apply_patch', { patch, session_id: 'ses_test' });
    console.log('apply_patch ok =', applied.structuredContent.ok, '| token =', applied.structuredContent.rollback_token);
    console.log('contenido:', JSON.stringify(sb.read('hola.txt')));

    const rb = await d.call('workspace.rollback', { rollback_token: applied.structuredContent.rollback_token, session_id: 'ses_test' });
    console.log('rollback ok =', rb.structuredContent.ok, '| contenido restaurado:', JSON.stringify(sb.read('hola.txt')));

    const shell = await d.call('terminal.exec', { action: 'run', program: 'node', args: ['-e', 'console.log(1+1)'], cwd: '.', session_id: 'ses_test' });
    console.log('\nterminal.exec node ->', shell.structuredContent.ok ? shell.structuredContent.stdout.trim() : shell.structuredContent.error);

    const bad = await d.call('terminal.exec', { action: 'run', program: 'cmd', args: ['/c', 'dir'], cwd: '.', session_id: 'ses_test' });
    console.log('terminal.exec cmd ->', bad.structuredContent.error);

    const inject = await d.call('terminal.exec', { action: 'run', program: 'node', args: ['-e', 'x', '&', 'calc'], cwd: '.', session_id: 'ses_test' });
    console.log('terminal.exec con & ->', inject.structuredContent.error);

    const legacy = await d.call('run_command', { command: 'dir' });
    console.log('\nalias legacy run_command ->', legacy.structuredContent.error, '|', legacy.structuredContent.message);

    const chain = sb.runtime.journal.verify();
    console.log('\ncadena del diario:', JSON.stringify(chain));
  } finally {
    sb.cleanup();
  }
})().catch((e) => {
  console.error('FALLO:', e);
  process.exit(1);
});
