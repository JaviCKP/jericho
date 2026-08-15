'use strict';

/** Comprobación rápida de que el runtime arranca y el dispatcher responde. */

const { makeSandbox } = require('./helpers/sandbox');
const { Dispatcher } = require('../src/tools/dispatch');
const { IMPLEMENTATIONS } = require('../src/tools');
const { recover } = require('../src/core/runtime');

(async () => {
  const sb = makeSandbox({ env: { GHOSTPC_SESSION_AUTH_SECRET: 'smoke-session-secret' } });
  try {
    const rec = await recover(sb.runtime);
    console.log('recuperación:', JSON.stringify(rec.orphans), 'cadena diario válida:', rec.journal_chain.valid);

    const d = new Dispatcher(sb.runtime, IMPLEMENTATIONS);
    const auth = { sessionToken: sb.runtime.sessionAuthority.issue({
      session_id: 'ses_test', user_id: 'user_test', project_id: 'smoke', permissions: ['read', 'write'], profile: 'development',
    }) };
    const call = (name, args) => d.call(name, args, auth);
    const tools = d.listTools();
    console.log(`herramientas expuestas: ${tools.length} -> ${tools.map((t) => t.name).join(', ')}`);
    console.log('bytes de tools/list:', JSON.stringify({ tools }).length);

    sb.write('hola.txt', 'linea1\nlinea2\n');

    const status = await call('ghostpc.status', {});
    console.log('\nghostpc.status ok =', status.structuredContent.ok);

    const read = await call('workspace.read', { paths: ['hola.txt'] });
    console.log('workspace.read ok =', read.structuredContent.ok, '| sha256 =', read.structuredContent.files[0].sha256.slice(0, 12));

    const escape = await call('workspace.read', { paths: ['../../../Windows/win.ini'] });
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
    const dry = await call('workspace.apply_patch', { patch, dry_run: true });
    console.log('apply_patch dry-run ok =', dry.structuredContent.ok, '| applied =', dry.structuredContent.applied);

    const applied = await call('workspace.apply_patch', { patch });
    console.log('apply_patch ok =', applied.structuredContent.ok, '| token =', applied.structuredContent.rollback_token);
    console.log('contenido:', JSON.stringify(sb.read('hola.txt')));

    const rb = await call('workspace.rollback', { rollback_token: applied.structuredContent.rollback_token });
    console.log('rollback ok =', rb.structuredContent.ok, '| contenido restaurado:', JSON.stringify(sb.read('hola.txt')));

    const shell = await call('terminal.exec', { action: 'run', program: 'node', args: ['-e', 'console.log(1+1)'], cwd: '.' });
    console.log('\nterminal.exec node ->', shell.structuredContent.ok ? shell.structuredContent.stdout.trim() : shell.structuredContent.error);

    const bad = await call('terminal.exec', { action: 'run', program: 'cmd', args: ['/c', 'dir'], cwd: '.' });
    console.log('terminal.exec cmd ->', bad.structuredContent.error);

    const inject = await call('terminal.exec', { action: 'run', program: 'node', args: ['-e', 'x', '&', 'calc'], cwd: '.' });
    console.log('terminal.exec con & ->', inject.structuredContent.error);

    const legacy = await call('run_command', { command: 'dir' });
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
