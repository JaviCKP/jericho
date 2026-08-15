'use strict';
const h = require('../harness');
(async () => {
  for (const m of ['./catalog.test.js', './conformance.test.js', './protocol.test.js']) await require(m).run();
  const s = h.summary('CONTRATO :: TODAS');
  process.exit(s.failed ? 1 : 0);
})();
