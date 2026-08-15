'use strict';
const h = require('../harness');
const { spawnSync } = require('child_process');
const path = require('path');
const SUITES = [
  './paths.test.js', './injection.test.js', './injection_prompt.test.js', './secrets.test.js',
  './network.test.js', './memory.test.js', './patch.test.js', './processes.test.js', './desktop.test.js',
  './session_authority_hardening.test.js',
  './git_facade_hardening.test.js', './secret_redaction_hardening.test.js',
];
(async () => {
  for (const m of SUITES) await require(m).run();
  // exec_process_hardening uses Node's native test runner; execute it as a
  // child so its tests are included without mixing two harnesses or exiting
  // before node:test has flushed its results.
  const native = spawnSync(process.execPath, ['--test', path.join(__dirname, 'exec_process_hardening.test.js')], { encoding: 'utf8' });
  if (native.status !== 0) await h.test('exec_process_hardening.test.js', () => { throw new Error(native.stderr || native.stdout); });
  else await h.test('exec_process_hardening.test.js', () => {});
  const s = h.summary('SEGURIDAD :: TODAS');
  process.exit(s.failed ? 1 : 0);
})();
