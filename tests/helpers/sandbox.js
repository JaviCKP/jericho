'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Crea un runtime de Jericho completamente aislado en un directorio temporal.
 * Cada prueba obtiene su propio workspace, política, diario y memoria.
 */
function makeSandbox(overrides = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jericho-test-'));
  const ws = path.join(base, 'workspace');
  const control = path.join(base, 'control');
  const memory = path.join(base, 'memory');
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(control, { recursive: true });
  fs.mkdirSync(memory, { recursive: true });

  const env = {
    PATH: process.env.PATH,
    Path: process.env.Path,
    PATHEXT: process.env.PATHEXT,
    SystemRoot: process.env.SystemRoot,
    COMSPEC: process.env.COMSPEC,
    windir: process.env.windir,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    ...(overrides.env || {}),
  };

  const policyFile = path.join(control, 'policy.json');
  if (overrides.policy) {
    fs.writeFileSync(policyFile, JSON.stringify(overrides.policy, null, 2), 'utf-8');
  }

  const { createRuntime } = require('../../src/core/runtime');
  const { PROFILES } = require('../../src/tools/profiles');

  const runtime = createRuntime({
    env,
    controlDir: control,
    policyFile,
    journalDir: path.join(control, 'journal'),
    approvalsDir: path.join(control, 'approvals'),
    processStateFile: path.join(control, 'processes.json'),
    memoryDir: memory,
    rootDefinitions: overrides.rootDefinitions || [{ name: 'workspace', path: ws }],
    profiles: overrides.profiles || PROFILES,
    extraSecretValues: overrides.extraSecretValues || [],
  });

  return {
    base,
    workspace: ws,
    controlDir: control,
    memoryDir: memory,
    policyFile,
    runtime,
    /** Escribe un archivo dentro del workspace de prueba. */
    write(rel, content) {
      const p = path.join(ws, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content, 'utf-8');
      return p;
    },
    read(rel) {
      return fs.readFileSync(path.join(ws, rel), 'utf-8');
    },
    exists(rel) {
      return fs.existsSync(path.join(ws, rel));
    },
    cleanup() {
      try {
        fs.rmSync(base, { recursive: true, force: true });
      } catch (e) {
        /* Windows a veces retiene handles; no es fatal en pruebas */
      }
    },
  };
}

module.exports = { makeSandbox };
