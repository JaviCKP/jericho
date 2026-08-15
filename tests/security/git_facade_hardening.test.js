'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Roots } = require('../../src/core/workspace/paths');
const { Git } = require('../../src/core/git');

function gitRaw(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jericho-git-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  gitRaw(repo, ['init', '-q']);
  gitRaw(repo, ['config', 'user.name', 'Jericho test']);
  gitRaw(repo, ['config', 'user.email', 'jericho@example.invalid']);
  fs.writeFileSync(path.join(repo, 'file.txt'), 'safe\n');
  const marker = path.join(root, 'hook-ran');
  const hook = path.join(repo, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')"\n`);
  if (process.platform !== 'win32') fs.chmodSync(hook, 0o755);

  const roots = new Roots([{ name: 'fixture', path: root }]);
  const calls = [];
  const runner = { run: async (request) => {
    calls.push(request);
    const out = gitRaw(request.cwd, request.args);
    return { exit_code: 0, stdout: out, stderr: '' };
  } };
  const git = new Git(runner, roots);

  await git.commit(repo, { message: 'safe commit', files: ['file.txt'] }, {});
  assert.strictEqual(fs.existsSync(marker), false, 'el hook del repositorio no debe ejecutarse');
  assert.ok(calls.every((c) => c.args.includes('--no-pager') && c.args.includes('core.hooksPath=')));

  await assert.rejects(() => git._git(['-C', repo, 'status'], repo), /Opción Git no permitida/);
  await assert.rejects(() => git._git(['--git-dir=' + repo, 'status'], repo), /Opción Git no permitida/);
  await assert.rejects(() => git._git(['--work-tree=' + root, 'status'], repo), /Opción Git no permitida/);
  await assert.rejects(() => git._git(['push'], repo), /no está disponible/);
  await assert.rejects(() => git._git(['clone', 'https://example.invalid/x', path.join(root, 'dest')], repo), /no está disponible/);
  await assert.rejects(() => git.statusPorcelain(path.join(root, 'outside')), /La ruta no existe|fuera/);

  // Sin roots no existe una vía de compatibilidad: incluso las lecturas
  // internas deben pasar por un repositorio previamente autorizado.
  const internal = new Git(runner);
  await assert.rejects(() => internal.statusPorcelain(repo), /raíz autorizada/);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('git facade hardening: 8 passed, 0 failed, 0 skipped');
}

if (require.main === module) run().catch((err) => { console.error(err); process.exitCode = 1; });
module.exports = { run };
