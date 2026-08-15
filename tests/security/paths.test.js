'use strict';

/**
 * Aislamiento del sistema de archivos: path traversal, escape por enlaces,
 * formas de ruta peligrosas y lista de exclusiones sensibles.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const h = require('../harness');
const { Roots, canonicalize, isInside } = require('../../src/core/workspace/paths');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jericho-paths-'));
const ws = path.join(base, 'ws');
const outside = path.join(base, 'outside');
const control = path.join(base, 'control');

fs.mkdirSync(path.join(ws, 'sub'), { recursive: true });
fs.mkdirSync(outside, { recursive: true });
fs.mkdirSync(control, { recursive: true });
fs.writeFileSync(path.join(ws, 'ok.txt'), 'ok');
fs.writeFileSync(path.join(ws, '.env'), 'CONTROL_PLANE_API_KEY=sk-real');
fs.writeFileSync(path.join(outside, 'secret.txt'), 'stolen');
fs.writeFileSync(path.join(control, 'policy.json'), '{}');

const roots = new Roots([{ name: 'workspace', path: ws }], [control]);

async function run() {
  h.suite('paths :: resolución legítima');

  await h.test('ruta relativa dentro de la raíz', () => {
    h.equal(roots.resolve('ok.txt').relative, 'ok.txt');
  });

  await h.test('".." que no sale de la raíz se normaliza', () => {
    h.equal(roots.resolve('sub/../ok.txt').relative, 'ok.txt');
  });

  await h.test('ruta absoluta dentro de la raíz', () => {
    h.equal(roots.resolve(path.join(ws, 'ok.txt')).relative, 'ok.txt');
  });

  await h.test('archivo nuevo para escritura (aún no existe)', () => {
    const r = roots.resolve('nuevo/dir/f.txt', { forWrite: true });
    h.equal(r.exists, false);
    h.equal(r.relative, 'nuevo/dir/f.txt');
  });

  h.suite('paths :: path traversal');

  await h.test('".." sale de la raíz -> PATH_OUTSIDE_ROOT', () =>
    h.throwsCode(() => roots.resolve('../outside/secret.txt'), 'PATH_OUTSIDE_ROOT'));

  await h.test('traversal profundo -> PATH_OUTSIDE_ROOT', () =>
    h.throwsCode(() => roots.resolve('sub/../../outside/secret.txt'), 'PATH_OUTSIDE_ROOT'));

  await h.test('traversal repetido -> PATH_OUTSIDE_ROOT', () =>
    h.throwsCode(() => roots.resolve('../../../../../../etc/passwd'), 'PATH_OUTSIDE_ROOT'));

  await h.test('ruta absoluta fuera de la raíz -> PATH_OUTSIDE_ROOT', () =>
    h.throwsCode(() => roots.resolve(path.join(outside, 'secret.txt')), 'PATH_OUTSIDE_ROOT'));

  await h.test('directorio de sistema -> denegado', async () => {
    const err = await h.throwsCode(() =>
      roots.resolve(process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/passwd')
    );
    h.ok(['PATH_OUTSIDE_ROOT', 'PATH_DENIED'].includes(err.code), `código inesperado: ${err.code}`);
  });

  await h.test('rutas de control de Jericho no accesibles', async () => {
    const err = await h.throwsCode(() => roots.resolve(path.join(control, 'policy.json')));
    h.ok(['PATH_OUTSIDE_ROOT', 'PATH_DENIED'].includes(err.code), `código inesperado: ${err.code}`);
  });

  h.suite('paths :: formas de ruta peligrosas');

  await h.test('UNC \\\\servidor\\recurso -> PATH_DENIED', () =>
    h.throwsCode(() => roots.resolve('\\\\evil\\share\\x'), 'PATH_DENIED'));

  await h.test('UNC con barras normales -> PATH_DENIED', () =>
    h.throwsCode(() => roots.resolve('//evil/share/x'), 'PATH_DENIED'));

  await h.test('espacio de nombres de dispositivo \\\\?\\ -> PATH_DENIED', () =>
    h.throwsCode(() => roots.resolve('\\\\?\\C:\\Windows\\win.ini'), 'PATH_DENIED'));

  await h.test('flujo de datos alternativo (ADS) -> PATH_DENIED', () =>
    h.throwsCode(() => roots.resolve('ok.txt:oculto'), 'PATH_DENIED'));

  await h.test('nombre de dispositivo reservado CON -> PATH_DENIED', () =>
    h.throwsCode(() => roots.resolve('CON'), 'PATH_DENIED'));

  await h.test('nombre de dispositivo reservado en subruta -> PATH_DENIED', () =>
    h.throwsCode(() => roots.resolve('sub/NUL.txt'), 'PATH_DENIED'));

  await h.test('nombre corto 8.3 -> PATH_DENIED', () =>
    h.throwsCode(() => roots.resolve('PROGRA~1/x'), 'PATH_DENIED'));

  await h.test('byte NUL -> PATH_DENIED', () =>
    h.throwsCode(() => roots.resolve('ok.txt\u0000.png'), 'PATH_DENIED'));

  h.suite('paths :: exclusiones sensibles dentro de la raíz');

  await h.test('.env dentro de la raíz -> PATH_DENIED', () =>
    h.throwsCode(() => roots.resolve('.env'), 'PATH_DENIED'));

  await h.test('.env.production -> PATH_DENIED', () =>
    h.throwsCode(() => roots.resolve('.env.production'), 'PATH_DENIED'));

  await h.test('*.pem -> PATH_DENIED', () =>
    h.throwsCode(() => roots.resolve('certs/server.pem'), 'PATH_DENIED'));

  await h.test('*.key -> PATH_DENIED', () =>
    h.throwsCode(() => roots.resolve('certs/server.key'), 'PATH_DENIED'));

  await h.test('.ssh/id_rsa -> PATH_DENIED', () =>
    h.throwsCode(() => roots.resolve('.ssh/id_rsa'), 'PATH_DENIED'));

  await h.test('.aws/credentials -> PATH_DENIED', () =>
    h.throwsCode(() => roots.resolve('.aws/credentials'), 'PATH_DENIED'));

  await h.test('.npmrc -> PATH_DENIED', () =>
    h.throwsCode(() => roots.resolve('.npmrc'), 'PATH_DENIED'));

  h.suite('paths :: escape por enlace simbólico / junction');

  let linkKind = null;
  const linkPath = path.join(ws, 'escape');
  for (const kind of ['junction', 'dir']) {
    try {
      fs.symlinkSync(outside, linkPath, kind);
      linkKind = kind;
      break;
    } catch (e) {
      /* sin permisos para crear enlaces: se prueba el siguiente tipo */
    }
  }

  if (!linkKind) {
    console.log('  [SKIP] enlaces no creables en este entorno (falta privilegio de symlink)');
  } else {
    await h.test(`${linkKind} que apunta fuera: acceso al destino -> denegado`, async () => {
      const err = await h.throwsCode(() => roots.resolve('escape/secret.txt'));
      h.ok(['PATH_OUTSIDE_ROOT', 'PATH_LINK_ESCAPE'].includes(err.code), `código inesperado: ${err.code}`);
    });

    await h.test(`${linkKind} que apunta fuera: acceso al propio enlace -> denegado`, async () => {
      const err = await h.throwsCode(() => roots.resolve('escape'));
      h.ok(['PATH_OUTSIDE_ROOT', 'PATH_LINK_ESCAPE'].includes(err.code), `código inesperado: ${err.code}`);
    });

    await h.test(`escritura a través de ${linkKind} -> denegada`, async () => {
      const err = await h.throwsCode(() => roots.resolve('escape/nuevo.txt', { forWrite: true }));
      h.ok(['PATH_OUTSIDE_ROOT', 'PATH_LINK_ESCAPE'].includes(err.code), `código inesperado: ${err.code}`);
    });
  }

  // Enlace interno legítimo: debe permitirse.
  const innerTarget = path.join(ws, 'sub');
  const innerLink = path.join(ws, 'alias');
  let innerOk = false;
  for (const kind of ['junction', 'dir']) {
    try {
      fs.symlinkSync(innerTarget, innerLink, kind);
      innerOk = true;
      break;
    } catch (e) {
      /* ignorado */
    }
  }
  if (innerOk) {
    fs.writeFileSync(path.join(innerTarget, 'inner.txt'), 'x');
    await h.test('enlace interno a la misma raíz -> permitido', () => {
      const r = roots.resolve('alias/inner.txt');
      h.equal(r.relative, 'sub/inner.txt');
    });
  }

  h.suite('paths :: raíces');

  await h.test('el agente no puede añadir raíces (no hay API para ello)', () => {
    h.equal(typeof roots.addRoot, 'undefined');
    h.equal(roots.list().length, 1);
  });

  await h.test('raíz de sólo lectura rechaza escrituras', async () => {
    const ro = new Roots([{ name: 'ro', path: ws, write: false }], [control]);
    await h.throwsCode(() => ro.resolve('ok.txt', { forWrite: true }), 'PATH_DENIED');
    h.equal(ro.resolve('ok.txt').relative, 'ok.txt');
  });

  await h.test('mustExist sobre ruta inexistente -> PATH_NOT_FOUND', () =>
    h.throwsCode(() => roots.resolve('no-existe.txt', { mustExist: true }), 'PATH_NOT_FOUND'));

  await h.test('isInside no confunde prefijos parciales', () => {
    h.equal(isInside('/a/bc', '/a/b'), false);
    h.equal(isInside('/a/b/c', '/a/b'), true);
    h.equal(isInside('/a/b', '/a/b'), true);
  });

  await h.test('canonicalize normaliza separadores y barra final', () => {
    h.equal(canonicalize('/a/b/'), canonicalize('/a/b'));
  });
}

run()
  .then(() => {
    fs.rmSync(base, { recursive: true, force: true });
    if (require.main === module) h.exitWithSummary('SEGURIDAD :: RUTAS');
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

module.exports = { run };
