#!/usr/bin/env node
'use strict';

/**
 * Ejecuta todas las suites en un solo proceso y devuelve un resumen agregado.
 * `npm test`
 */

const path = require('path');
const h = require('./harness');

const SUITES = [
  ['seguridad/rutas', './security/paths.test.js'],
  ['seguridad/inyección', './security/injection.test.js'],
  ['seguridad/prompt-injection', './security/injection_prompt.test.js'],
  ['seguridad/secretos', './security/secrets.test.js'],
  ['seguridad/red', './security/network.test.js'],
  ['seguridad/memoria', './security/memory.test.js'],
  ['seguridad/parches', './security/patch.test.js'],
  ['seguridad/procesos', './security/processes.test.js'],
  ['seguridad/gui', './security/desktop.test.js'],
  ['contrato/catálogo', './contract/catalog.test.js'],
  ['contrato/conformidad', './contract/conformance.test.js'],
  ['contrato/protocolo', './contract/protocol.test.js'],
];

(async () => {
  const inicio = Date.now();
  console.log('================================================================');
  console.log('               Jericho v2 — SUITE COMPLETA');
  console.log('================================================================');

  for (const [nombre, modulo] of SUITES) {
    console.log(`\n\n########## ${nombre} ##########`);
    try {
      const suite = require(modulo);
      await suite.run();
    } catch (err) {
      h.suite(nombre);
      console.log(`  [FAIL] la suite lanzó una excepción :: ${err && err.message}`);
      h.results.push({ suite: nombre, name: 'ejecución de la suite', ok: false, detail: String(err && err.stack) });
    }
  }

  console.log(`\n\nDuración total: ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
  const s = h.summary('Jericho v2 — RESULTADO GLOBAL');

  // Desglose por suite, útil para EVALS.md.
  const porSuite = new Map();
  for (const r of h.results) {
    if (!porSuite.has(r.suite)) porSuite.set(r.suite, { total: 0, pass: 0 });
    const e = porSuite.get(r.suite);
    e.total++;
    if (r.ok) e.pass++;
  }
  console.log('\nDesglose por grupo:');
  for (const [nombre, e] of porSuite) {
    console.log(`  ${e.pass === e.total ? 'OK  ' : 'FAIL'} ${String(e.pass).padStart(3)}/${String(e.total).padEnd(3)} ${nombre}`);
  }

  process.exit(s.failed ? 1 : 0);
})();
