'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveProgram, assertSubcommandAllowed } = require('../../src/core/exec/program');
const { ExecRunner } = require('../../src/core/exec/runner');
const { GhostError, CODES } = require('../../src/core/errors');

const policy = {
  exec: {
    allowed_programs: ['node', 'npm', 'npx', 'python', 'git'],
    denied_subcommands: { git: ['push', 'config'] },
    env_passthrough: [],
  },
  limits: { exec: { max_concurrent: 1, max_background: 1, timeout_ms: 1000, max_output_bytes: 1024, background_ttl_ms: 1000 } },
};

test('interpreters, package managers, shells and generic git are fail-closed', () => {
  for (const program of ['node', 'NODE.EXE', 'npm', 'npx', 'python', 'python3', 'cmd', 'powershell', 'pwsh', 'git']) {
    assert.throws(() => resolveProgram(program, policy.exec), (err) => err.code === CODES.COMMAND_NOT_ALLOWED);
  }
});

test('known indirect execution forms are blocked before argv parsing', () => {
  const attempts = [
    ['node', ['--eval', 'process.exit(1)']],
    ['python', ['-m', 'pip']],
    ['npm', ['exec', 'evil']],
    ['npx', ['--yes', 'evil']],
    ['npm', ['run', 'script']],
    ['powershell', ['-Command', 'Write-Host evil']],
    ['cmd', ['/c', 'whoami']],
  ];
  for (const [program, args] of attempts) {
    assert.throws(() => resolveProgram(program, policy.exec), (err) => err.code === CODES.COMMAND_NOT_ALLOWED, `${program} ${args.join(' ')}`);
  }
});

test('denied git operations cannot hide behind options', () => {
  for (const args of [['--', 'push'], ['--config=push'], ['-c', 'push'], ['--foo', 'config']]) {
    assert.throws(() => assertSubcommandAllowed('git', args, policy.exec), GhostError);
  }
});

test('secrets are never handed to a child with unrestricted network', () => {
  const runner = new ExecRunner({
    policy,
    registry: { countRunning: () => 0 },
    secrets: { isAvailable: () => true, materializeForProcess: () => ({ SYNTHETIC: 'x' }) },
  });
  assert.throws(
    () => runner.plan({ program: 'node', args: ['-v'], cwd: process.cwd(), secretNames: ['SYNTHETIC'] }),
    (err) => err.code === CODES.SECRET_NOT_ALLOWED || err.code === CODES.COMMAND_NOT_ALLOWED
  );
});
