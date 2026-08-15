'use strict';
const h = require('../harness');
const SUITES = [
  './paths.test.js', './injection.test.js', './injection_prompt.test.js', './secrets.test.js',
  './network.test.js', './memory.test.js', './patch.test.js', './processes.test.js', './desktop.test.js',
];
(async () => {
  for (const m of SUITES) await require(m).run();
  const s = h.summary('SEGURIDAD :: TODAS');
  process.exit(s.failed ? 1 : 0);
})();
