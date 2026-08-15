'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const h = require('../harness');
const { makeSandbox } = require('../helpers/sandbox');
const { Dispatcher } = require('../../src/tools/dispatch');
const { IMPLEMENTATIONS } = require('../../src/tools');

const MARKER = path.join(os.tmpdir(), `jericho-injection-marker-${process.pid}.txt`);
function clearMarker() { try { fs.unlinkSync(MARKER); } catch (_) {} }

async function run() {
  const sb = makeSandbox({ env: { JERICHO_SESSION_AUTH_SECRET: 'synthetic-test-secret' } });
  const d = new Dispatcher(sb.runtime, IMPLEMENTATIONS);
  const S = { session_id: 'ses_injection' };
  const rawCall = d.call.bind(d);
  d.call = (name, args = {}) => {
    const token = sb.runtime.sessionAuthority.issue({ session_id: args.session_id || 'ses_injection', user_id: 'user_injection', project_id: 'project_injection', permissions: ['read', 'write'], profile: 'development' });
    return rawCall(name, args, { sessionToken: token });
  };
  try {
    h.suite('inyección :: terminal.exec fail-closed');
    for (const [label, program, args] of [
      ['cmd shell no permitido', 'cmd', ['/c', 'echo hi']],
      ['bash shell no permitido', 'bash', ['-c', 'ls']],
      ['sh shell no permitido', 'sh', ['-c', 'ls']],
      ['absolute program path', 'C:\\Windows\\System32\\cmd.exe', []],
      ['relative program path', './node', []],
      ['programa desconocido', 'evil_binary', []],
      ['git push prohibido', 'git', ['push', 'origin', 'main']],
      ['npm publish prohibido', 'npm', ['publish']],
    ]) {
      await h.test(`${label} es rechazado`, async () => {
        clearMarker();
        const r = await d.call('terminal.exec', { action: 'run', program, args, cwd: '.', ...S });
        h.deniedWith(r, 'COMMAND_NOT_ALLOWED');
        h.equal(fs.existsSync(MARKER), false);
      });
    }

    for (const [label, payload] of [
      ['ampersand', `A & echo pwned > "${MARKER}"`],
      ['pipe', `A | echo pwned > "${MARKER}"`],
      ['redirect', `A > "${MARKER}"`],
      ['backtick', `\`echo pwned > "${MARKER}"\``],
      ['chain', `A && echo pwned > "${MARKER}"`],
    ]) {
      await h.test(`payload ${label} no se interpreta como comando de shell`, async () => {
        clearMarker();
        await d.call('terminal.exec', { action: 'run', program: 'node', args: ['-e', 'process.exit(0)', payload], cwd: '.', ...S });
        h.equal(fs.existsSync(MARKER), false, `¡Inyección de shell ejecutada para ${label}!`);
      });
    }

    await h.test('git.commit con mensaje inyectado no toca repositorio', async () => {
      clearMarker();
      const r = await d.call('git.commit', { action: 'commit', path: 'repo', files: ['repo/a.txt'], message: `ok" & echo pwned> ${MARKER}`, ...S });
      h.equal(fs.existsSync(MARKER), false);
      h.equal(r.structuredContent.ok, false);
      h.ok(['NOT_FOUND', 'PATH_NOT_FOUND', 'PATH_OUTSIDE_ROOT', 'PATH_DENIED'].includes(r.structuredContent.error));
    });
    await h.test('git.commit exige repo autorizado y lista explícita', async () => {
      const r = await d.call('git.commit', { action: 'commit', path: 'repo', message: 'sin archivos', ...S });
      h.equal(r.structuredContent.ok, false);
      h.ok(['NOT_FOUND', 'PATH_NOT_FOUND', 'INVALID_ARGUMENT', 'PATH_DENIED'].includes(r.structuredContent.error));
    });
    await h.test('git.inspect fuera de raíz no accede al archivo', async () => {
      const r = await d.call('git.inspect', { action: 'diff', path: 'repo', file: '../../../etc/passwd', ...S });
      h.equal(r.structuredContent.ok, false);
      h.ok(['NOT_FOUND', 'PATH_NOT_FOUND', 'PATH_OUTSIDE_ROOT', 'PATH_DENIED'].includes(r.structuredContent.error));
    });
    await h.test('git.commit con archivo fuera de raíz no accede al archivo', async () => {
      const r = await d.call('git.commit', { action: 'commit', path: 'repo', files: ['../../../etc/passwd'], message: 'x', ...S });
      h.equal(r.structuredContent.ok, false);
      h.ok(['NOT_FOUND', 'PATH_NOT_FOUND', 'PATH_OUTSIDE_ROOT', 'PATH_DENIED'].includes(r.structuredContent.error));
    });
  } finally { clearMarker(); sb.cleanup(); }
}
if (require.main === module) run().then(() => h.exitWithSummary('SEGURIDAD :: INYECCIÓN'));
module.exports = { run };
