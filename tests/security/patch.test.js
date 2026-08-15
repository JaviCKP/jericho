'use strict';

/**
 * Motor de parches: atomicidad, precondiciones de hash, ambigüedad y rollback.
 * Cubre P1-4 (edición ambigua silenciosa) y P1-5 (sin escritura atómica).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const h = require('../harness');
const { makeSandbox } = require('../helpers/sandbox');
const { Dispatcher } = require('../../src/tools/dispatch');
const { IMPLEMENTATIONS } = require('../../src/tools');
const { sha256Text } = require('../../src/core/atomic');

function diff(file, before, after) {
  const b = before.split('\n');
  const a = after.split('\n');
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${b.length} +1,${a.length} @@`,
    ...b.map((l) => `-${l}`),
    ...a.map((l) => `+${l}`),
    '',
  ].join('\n');
}

async function run() {
  const sb = makeSandbox({ env: { JERICHO_SESSION_AUTH_SECRET: 'patch-test-session-secret', JERICHO_OPERATOR_SECRET: 'patch-test-operator-secret' } });
  const d = new Dispatcher(sb.runtime, IMPLEMENTATIONS);
  const S = { session_id: 'ses_patch' };
  const callAs = (name, args, project = 'patch') => {
    const token = sb.runtime.sessionAuthority.issue({ session_id: S.session_id, user_id: 'user_patch', project_id: project, permissions: ['read', 'write'], profile: 'development' });
    return d.call(name, args, { sessionToken: token });
  };
  const operatorApprove = (id, approved = true) => {
    const pending = sb.runtime.approvals.listPending().find((x) => x.approval_id === id);
    const signature = crypto.createHmac('sha256', 'patch-test-operator-secret').update(`${id}:${pending.nonce}:${approved ? 'approve' : 'deny'}`).digest('hex');
    return sb.runtime.approvals.decide(id, approved, 'operator', { channel: 'operator', authenticated: true, acl: ['approval:decide'], nonce: pending.nonce, signature });
  };

  try {
    h.suite('parches :: aplicación básica');

    sb.write('src/app.js', 'const a = 1;\nconst b = 2;\n');

    await h.test('dry_run no escribe nada pero informa de lo que pasaría', async () => {
      const p = diff('src/app.js', 'const a = 1;\nconst b = 2;\n', 'const a = 10;\nconst b = 2;\n');
      const r = await d.call('workspace.apply_patch', { patch: p, dry_run: true, ...S });
      h.equal(r.structuredContent.ok, true, r.structuredContent.message);
      h.equal(r.structuredContent.applied, false);
      h.equal(r.structuredContent.files[0].path, 'src/app.js');
      h.equal(sb.read('src/app.js'), 'const a = 1;\nconst b = 2;\n');
    });

    let token;
    await h.test('aplicación real y rollback_token', async () => {
      const p = diff('src/app.js', 'const a = 1;\nconst b = 2;\n', 'const a = 10;\nconst b = 2;\n');
      const r = await callAs('workspace.apply_patch', { patch: p, ...S });
      h.equal(r.structuredContent.ok, true, r.structuredContent.message);
      h.equal(r.structuredContent.applied, true);
      h.includes(sb.read('src/app.js'), 'const a = 10;');
      token = r.structuredContent.rollback_token;
      h.ok(token, 'no se devolvió rollback_token');
    });

    await h.test('rollback restaura el contenido exacto anterior', async () => {
      const r = await callAs('workspace.rollback', { rollback_token: token, ...S });
      h.equal(r.structuredContent.ok, true, r.structuredContent.message);
      h.equal(sb.read('src/app.js'), 'const a = 1;\nconst b = 2;\n');
    });

    await h.test('un rollback_token ya usado no se puede reutilizar', async () => {
      const r = await d.call('workspace.rollback', { rollback_token: token, ...S });
      h.deniedWith(r, 'NOT_FOUND');
    });

    h.suite('parches :: precondición de hash');

    await h.test('expected_hashes correcto -> se aplica', async () => {
      const contenido = sb.read('src/app.js');
      const p = diff('src/app.js', contenido, contenido.replace('const b = 2;', 'const b = 20;'));
      const r = await d.call('workspace.apply_patch', {
        patch: p,
        expected_hashes: { 'src/app.js': sha256Text(contenido) },
        ...S,
      });
      h.equal(r.structuredContent.ok, true, r.structuredContent.message);
    });

    await h.test('el archivo cambió entre lectura y escritura -> PRECONDITION_HASH_MISMATCH', async () => {
      const contenido = sb.read('src/app.js');
      const hashViejo = sha256Text(contenido);
      // Otra sesión (o la persona) modifica el archivo.
      sb.write('src/app.js', contenido + '// cambio de otra sesión\n');
      const p = diff('src/app.js', contenido, 'nuevo\n');
      const r = await d.call('workspace.apply_patch', {
        patch: p,
        expected_hashes: { 'src/app.js': hashViejo },
        ...S,
      });
      h.deniedWith(r, 'PRECONDITION_HASH_MISMATCH');
      h.includes(sb.read('src/app.js'), 'cambio de otra sesión');
    });

    await h.test('workspace.read devuelve el sha256 que espera apply_patch', async () => {
      const r = await d.call('workspace.read', { paths: ['src/app.js'], ...S });
      h.equal(r.structuredContent.files[0].sha256, sha256Text(sb.read('src/app.js')));
    });

    h.suite('parches :: ambigüedad (P1-4)');

    await h.test('un hunk que encaja en varios sitios -> PATCH_AMBIGUOUS', async () => {
      // El bloque A/X/B aparece dos veces: el parche no dice cuál cambiar.
      const original = 'A\nX\nB\nA\nX\nB\n';
      sb.write('src/dup.js', original);
      const p = ['--- a/src/dup.js', '+++ b/src/dup.js', '@@ -1,3 +1,3 @@', ' A', '-X', '+Y', ' B', ''].join('\n');
      const r = await callAs('workspace.apply_patch', { patch: p, ...S });
      h.deniedWith(r, 'PATCH_AMBIGUOUS');
      h.equal(sb.read('src/dup.js'), original, 'se modificó pese a ser ambiguo');
    });

    await h.test('el mismo cambio con contexto suficiente SÍ se aplica', async () => {
      const original = 'A\nX\nB\nA\nX\nB\n';
      sb.write('src/dup2.js', original);
      // Con contexto desde el principio del archivo, la posición es inequívoca.
      const p = [
        '--- a/src/dup2.js', '+++ b/src/dup2.js', '@@ -1,6 +1,6 @@',
        ' A', '-X', '+Y', ' B', ' A', ' X', ' B', '',
      ].join('\n');
      const r = await callAs('workspace.apply_patch', { patch: p, ...S });
      h.equal(r.structuredContent.ok, true, r.structuredContent.message);
      h.equal(sb.read('src/dup2.js'), 'A\nY\nB\nA\nX\nB\n');
    });

    h.suite('parches :: atomicidad (todo o nada)');

    await h.test('si un archivo del parche falla, NINGUNO se escribe', async () => {
      sb.write('src/uno.js', 'uno\n');
      const bueno = diff('src/uno.js', 'uno\n', 'UNO\n');
      const malo = diff('src/no-existe.js', 'algo\n', 'otra cosa\n');
      const r = await d.call('workspace.apply_patch', { patch: bueno + malo, ...S });
      h.equal(r.isError, true);
      h.equal(sb.read('src/uno.js'), 'uno\n', 'se escribió un archivo pese al fallo global');
    });

    await h.test('un parche fuera de la raíz no toca nada', async () => {
      const bueno = diff('src/uno.js', 'uno\n', 'UNO\n');
      const fuera = diff('../../../fuera.txt', 'x\n', 'y\n');
      const r = await d.call('workspace.apply_patch', { patch: bueno + fuera, ...S });
      h.equal(r.isError, true);
      h.equal(sb.read('src/uno.js'), 'uno\n');
      h.includes(JSON.stringify(r.structuredContent.details), 'PATH_OUTSIDE_ROOT');
    });

    await h.test('un parche sobre .env se rechaza', async () => {
      const p = diff('.env', 'A=1\n', 'A=2\n');
      const r = await d.call('workspace.apply_patch', { patch: p, ...S });
      h.equal(r.isError, true);
      h.includes(JSON.stringify(r.structuredContent.details), 'PATH_DENIED');
    });

    h.suite('parches :: creación y borrado');

    await h.test('crear un archivo nuevo', async () => {
      const p = ['--- /dev/null', '+++ b/src/nuevo.js', '@@ -0,0 +1,2 @@', '+linea A', '+linea B', ''].join('\n');
      const r = await d.call('workspace.apply_patch', { patch: p, ...S });
      h.equal(r.structuredContent.ok, true, r.structuredContent.message);
      h.equal(sb.read('src/nuevo.js'), 'linea A\nlinea B\n');
      h.equal(r.structuredContent.files[0].operation, 'create');
    });

    await h.test('un parche que borra archivos se clasifica como destructivo (R3)', async () => {
      const p = ['--- a/src/nuevo.js', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-linea A', '-linea B', ''].join('\n');
      const r = await callAs('workspace.apply_patch', { patch: p, ...S });
      h.deniedWith(r, 'APPROVAL_REQUIRED');
      h.equal(sb.exists('src/nuevo.js'), true, 'se borró sin aprobación');
    });

    await h.test('con aprobación humana, el borrado se ejecuta', async () => {
      const p = ['--- a/src/nuevo.js', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-linea A', '-linea B', ''].join('\n');
      const r1 = await callAs('workspace.apply_patch', { patch: p, ...S });
      const id = r1.structuredContent.details.approval_id;
      operatorApprove(id, true);
      const r2 = await callAs('workspace.apply_patch', { patch: p, approval_id: id, ...S });
      h.equal(r2.structuredContent.ok, true, r2.structuredContent.message);
      h.equal(sb.exists('src/nuevo.js'), false);
    });

    h.suite('parches :: límites y errores');

    await h.test('un parche que no aplica limpio -> PATCH_DID_NOT_APPLY', async () => {
      const p = ['--- a/src/uno.js', '+++ b/src/uno.js', '@@ -1,1 +1,1 @@', '-contenido que no existe', '+otro', ''].join('\n');
      const r = await d.call('workspace.apply_patch', { patch: p, ...S });
      h.equal(r.isError, true);
      h.includes(JSON.stringify(r.structuredContent.details), 'PATCH_DID_NOT_APPLY');
    });

    await h.test('un texto que no es un diff -> INVALID_ARGUMENT', async () => {
      const r = await d.call('workspace.apply_patch', { patch: 'esto no es un diff en absoluto', ...S });
      h.deniedWith(r, 'INVALID_ARGUMENT');
    });

    await h.test('se respeta el límite de archivos por parche', async () => {
      const limite = sb.runtime.policy.limits.patch.max_files;
      let p = '';
      for (let i = 0; i < limite + 3; i++) {
        p += ['--- /dev/null', `+++ b/src/gen${i}.js`, '@@ -0,0 +1,1 @@', '+x', ''].join('\n');
      }
      const r = await d.call('workspace.apply_patch', { patch: p, ...S });
      h.deniedWith(r, 'LIMIT_EXCEEDED');
      h.equal(sb.exists('src/gen0.js'), false);
    });

    await h.test('el diario registra los hashes antes y después', () => {
      const entries = sb.runtime.journal.readAll().filter((e) => e.kind === 'patch.applied');
      h.ok(entries.length >= 1);
      h.ok(entries[0].files[0].after, 'no se registró el hash resultante');
    });
  } finally {
    sb.cleanup();
  }
}

if (require.main === module) {
  run().then(() => h.exitWithSummary('SEGURIDAD :: PARCHES'));
}
module.exports = { run };
