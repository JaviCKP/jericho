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
      ['cmd shell', 'cmd', ['/c', 'echo hi']],
      ['powershell shell', 'powershell', ['-c', 'ls']],
      ['absolute program path', 'C:\\Windows\\System32\\cmd.exe', []],
      ['relative program path', './node', []],
      ['node --eval', 'node', ['--eval', 'process.stdout.write("x")']],
      ['python -m', 'python', ['-m', 'pip']],
      ['npm exec', 'npm', ['exec', 'evil']],
      ['npx package', 'npx', ['--yes', 'evil']],
      ['npm run script', 'npm', ['run', 'test']],
      ['git push', 'git', ['push', 'origin', 'main']],
      ['npm publish', 'npm', ['publish']],
    ]) {
      await h.test(`${label} no ejecuta procesos`, async () => {
        clearMarker();
        const r = await d.call('terminal.exec', { action: 'run', program, args, cwd: '.', ...S });
        h.deniedWith(r, 'COMMAND_NOT_ALLOWED');
        h.equal(fs.existsSync(MARKER), false);
      });
    }

    for (const [label, payload] of [
      ['ampersand', 'A&B'], ['pipe', 'A|B'], ['redirect', 'A>B'], ['backtick', 'A`B'],
      ['quote', 'A"B'], ['percent', '%USERPROFILE%'], ['bang', '!USERPROFILE!'],
      ['caret', 'A^B'], ['chain', 'A && echo pwned'],
    ]) {
      await h.test(`payload ${label} no se interpreta`, async () => {
        clearMarker();
        const r = await d.call('terminal.exec', { action: 'run', program: 'node', args: ['-e', 'x', payload], cwd: '.', ...S });
        h.deniedWith(r, 'COMMAND_NOT_ALLOWED');
        h.equal(fs.existsSync(MARKER), false);
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
