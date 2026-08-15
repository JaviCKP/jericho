'use strict';

const assert = require('assert');
const redact = require('../../src/core/redact');

// Valores sintéticos y no reutilizables fuera de esta prueba.
const secrets = ['x', 'abcd', 'abcdefg', 'abcdefgh', 'A'.repeat(32)];

function noLeak(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of secrets) {
    assert.ok(!text.includes(secret), `fuga literal ${secret.length}`);
    assert.ok(!text.includes(encodeURIComponent(secret)), `fuga URL ${secret.length}`);
    assert.ok(!text.includes(JSON.stringify(secret)), `fuga JSON ${secret.length}`);
    assert.ok(!text.includes(Buffer.from(secret).toString('base64')), `fuga base64 ${secret.length}`);
  }
}

function noLeakValues(value) {
  if (typeof value === 'string') return noLeak(value);
  if (Array.isArray(value)) return value.forEach(noLeakValues);
  if (value && typeof value === 'object') return Object.values(value).forEach(noLeakValues);
  return undefined;
}

function run() {
  redact._reset();
  redact.init({}, secrets);

  const stdout = `stdout=${secrets.join('|')}`;
  const stderr = `stderr=${encodeURIComponent(secrets[1])}`;
  const err = new Error(`error=${JSON.stringify(secrets[2])}`);
  const payload = {
    content: [{ type: 'text', text: stdout }],
    structuredContent: { stderr },
    resource: { mimeType: 'text/markdown', text: `url=https://host/?token=${secrets[3]}` },
    journal: [{ diff: secrets[4], args: ['--token', secrets[0]] }],
    temp: `Basic ${Buffer.from(secrets[2]).toString('base64')}`,
  };

  noLeak(redact.redactText(stdout));
  noLeak(redact.redactText(stderr));
  noLeak(redact.redactText(err.message));
  noLeakValues(redact.redactValue(err));
  noLeakValues(redact.redactValue(payload));
  noLeak(redact.redactUrl(`https://u:${secrets[3]}@host/path?api_key=${secrets[4]}`));
  noLeak(redact.redactText(`diff=${secrets[4]} args=${secrets[0]}`));
  assert.strictEqual(redact.containsKnownSecret(stdout), true);
  assert.strictEqual(redact.containsKnownSecret(Buffer.from(secrets[2]).toString('base64')), true);
  assert.strictEqual(redact.redactText(redact.redactText(stdout)), redact.redactText(stdout));
  console.log('secret_redaction_hardening: 10 passed, 0 failed, 0 skipped');
}

if (require.main === module) run();
module.exports = { run };
