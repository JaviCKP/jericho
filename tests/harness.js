'use strict';

/**
 * Arnés de pruebas mínimo, sin dependencias.
 * Se usa en tests/security, tests/contract y tests/evals.
 */

const results = [];
let currentSuite = '(root)';

function suite(name) {
  currentSuite = name;
  console.log(`\n--- ${name} ---`);
}

function record(name, ok, detail) {
  results.push({ suite: currentSuite, name, ok, detail: detail || '' });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail && !ok ? ' :: ' + detail : ''}`);
}

async function test(name, fn) {
  try {
    await fn();
    record(name, true);
  } catch (err) {
    record(name, false, err && err.message ? err.message : String(err));
  }
}

/* ----------------------------- aserciones ----------------------------- */

function ok(value, message) {
  if (!value) throw new Error(message || `se esperaba un valor verdadero, se recibió ${JSON.stringify(value)}`);
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `se esperaba ${JSON.stringify(expected)}, se recibió ${JSON.stringify(actual)}`);
  }
}

function notEqual(actual, unexpected, message) {
  if (actual === unexpected) throw new Error(message || `no se esperaba ${JSON.stringify(unexpected)}`);
}

function includes(haystack, needle, message) {
  const h = typeof haystack === 'string' ? haystack : JSON.stringify(haystack);
  if (!h.includes(needle)) {
    throw new Error(message || `se esperaba que contuviera ${JSON.stringify(needle)}; recibido: ${h.slice(0, 300)}`);
  }
}

function excludes(haystack, needle, message) {
  const h = typeof haystack === 'string' ? haystack : JSON.stringify(haystack);
  if (h.includes(needle)) {
    throw new Error(message || `NO debía contener ${JSON.stringify(needle)}`);
  }
}

/** Espera que `fn` lance un GhostError con el código indicado. */
async function throwsCode(fn, code, message) {
  let threw = null;
  try {
    await fn();
  } catch (err) {
    threw = err;
  }
  if (!threw) throw new Error(message || `se esperaba que fallara con ${code}, pero se permitió la operación`);
  if (code && threw.code !== code) {
    throw new Error(message || `se esperaba el código ${code}, se recibió ${threw.code || threw.message}`);
  }
  return threw;
}

/** Espera que un resultado de herramienta sea un error con el código indicado. */
function deniedWith(result, code, message) {
  const sc = result && result.structuredContent;
  if (!result || result.isError !== true) {
    throw new Error(message || `se esperaba isError=true con ${code}; recibido: ${JSON.stringify(result).slice(0, 300)}`);
  }
  if (code && (!sc || sc.error !== code)) {
    throw new Error(message || `se esperaba error=${code}; recibido: ${sc && sc.error}`);
  }
  return result;
}

function summary(title) {
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  const failed = total - passed;
  console.log(`\n================ ${title} ================`);
  console.log(`Total: ${total} | PASS: ${passed} | FAIL: ${failed}`);
  if (failed) {
    console.log('\nFallos:');
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - [${r.suite}] ${r.name}: ${r.detail}`);
    }
  }
  return { total, passed, failed, results };
}

function exitWithSummary(title) {
  const s = summary(title);
  process.exitCode = s.failed ? 1 : 0;
  return s;
}

module.exports = {
  suite,
  test,
  ok,
  equal,
  notEqual,
  includes,
  excludes,
  throwsCode,
  deniedWith,
  summary,
  exitWithSummary,
  results,
};
