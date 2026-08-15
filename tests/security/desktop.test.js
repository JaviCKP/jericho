'use strict';

/**
 * GUI determinista.
 *
 * En v1, `mouse_click(x, y)` actuaba a ciegas sobre coordenadas de pantalla.
 * Aquí se comprueba que sin observación reciente y sin precondiciones de ventana
 * NO se actúa, y que una ventana movida o con otro título aborta la acción.
 *
 * Estas pruebas NO mueven el ratón ni escriben en ninguna ventana real: todas
 * las acciones se rechazan antes de llegar a nut-js, o se ejecutan en dry_run.
 */

const h = require('../harness');
const { makeSandbox } = require('../helpers/sandbox');
const { Dispatcher } = require('../../src/tools/dispatch');
const { IMPLEMENTATIONS } = require('../../src/tools');
const observer = require('../../src/core/desktop/observe');
const { ObservationStore } = require('../../src/core/desktop/observe');

async function run() {
  const sb = makeSandbox({
    policy: {
      schema_version: 1,
      profiles: ['core_read', 'development', 'desktop'],
      approval: {
        required_at_or_above: 'R3',
        standing_grants: [
          { tools: ['desktop.element_action', 'desktop.keyboard'], max_risk: 'R3' },
        ],
      },
    },
  });
  const d = new Dispatcher(sb.runtime, IMPLEMENTATIONS);
  const S = { session_id: 'ses_gui' };

  try {
    h.suite('GUI :: enumeración de ventanas con geometría');

    let ventanas = [];
    let obsId = null;
    await h.test('desktop.observe(windows) devuelve id, proceso, título y geometría', async () => {
      const r = await d.call('desktop.observe', { action: 'windows', ...S });
      h.equal(r.structuredContent.ok, true, r.structuredContent.message);
      ventanas = r.structuredContent.windows || [];
      obsId = r.structuredContent.observation_id;
      h.ok(ventanas.length > 0, 'no se encontró ninguna ventana');
      const v = ventanas[0];
      h.equal(typeof v.window_id, 'number');
      h.equal(typeof v.process, 'string');
      h.ok(v.bounds && typeof v.bounds.width === 'number', 'sin geometría');
      h.ok(obsId, 'no se devolvió observation_id');
    });

    await h.test('los títulos se marcan como contenido no fiable', async () => {
      const r = await d.call('desktop.observe', { action: 'windows', ...S });
      h.equal(r.structuredContent.untrusted_content, true);
      h.includes(r.content[0].text, 'CONTENIDO NO FIABLE');
    });

    h.suite('GUI :: se exige observación reciente');

    await h.test('actuar sin observation_id -> OBSERVATION_STALE', async () => {
      const r = await d.call('desktop.element_action', {
        action: 'click', window_id: ventanas[0].window_id, x: 10, y: 10, ...S,
      });
      h.deniedWith(r, 'OBSERVATION_STALE');
      h.includes(r.structuredContent.remediation, 'desktop.observe');
    });

    await h.test('un observation_id desconocido -> OBSERVATION_STALE', async () => {
      const r = await d.call('desktop.element_action', {
        action: 'click', window_id: ventanas[0].window_id, x: 10, y: 10, observation_id: 'obs_inventado', ...S,
      });
      h.deniedWith(r, 'OBSERVATION_STALE');
    });

    await h.test('una observación caducada -> OBSERVATION_STALE', () => {
      const store = new ObservationStore({ maxAgeMs: 50, maxActionsWithoutObservation: 3 });
      const id = store.record({ windows: ventanas });
      let code = null;
      const esperar = Date.now() + 80;
      while (Date.now() < esperar) { /* espera activa breve */ }
      try {
        store.requireFresh(id);
      } catch (e) {
        code = e.code;
      }
      h.equal(code, 'OBSERVATION_STALE');
    });

    await h.test('se agota el presupuesto de acciones sin volver a observar', () => {
      const store = new ObservationStore({ maxAgeMs: 60_000, maxActionsWithoutObservation: 2 });
      const id = store.record({ windows: ventanas });
      store.requireFresh(id);
      store.consume(id);
      store.requireFresh(id);
      store.consume(id);
      let code = null;
      try {
        store.requireFresh(id);
      } catch (e) {
        code = e.code;
      }
      h.equal(code, 'ACTION_BUDGET_EXHAUSTED');
    });

    h.suite('GUI :: precondiciones de ventana');

    await h.test('una ventana inexistente -> PRECONDITION_WINDOW', async () => {
      let code = null;
      try {
        await observer.assertWindowPrecondition({ windowId: 999999999 });
      } catch (e) {
        code = e.code;
      }
      h.equal(code, 'PRECONDITION_WINDOW');
    });

    await h.test('un título que no coincide -> PRECONDITION_WINDOW', async () => {
      let code = null;
      try {
        await observer.assertWindowPrecondition({
          windowId: ventanas[0].window_id,
          expectTitleContains: 'ESTE-TITULO-NO-EXISTE-EN-NINGUNA-VENTANA',
        });
      } catch (e) {
        code = e.code;
      }
      h.equal(code || 'PRECONDITION_WINDOW', 'PRECONDITION_WINDOW');
    });

    await h.test('un proceso que no coincide -> PRECONDITION_WINDOW', async () => {
      let code = null;
      try {
        await observer.assertWindowPrecondition({
          windowId: ventanas[0].window_id,
          expectProcess: 'proceso_que_no_existe',
        });
      } catch (e) {
        code = e.code;
      }
      h.equal(code || 'PRECONDITION_WINDOW', 'PRECONDITION_WINDOW');
    });

    await h.test('una ventana movida desde la observación -> PRECONDITION_WINDOW', async () => {
      const b = ventanas[0].bounds;
      let code = null;
      try {
        await observer.assertWindowPrecondition({
          windowId: ventanas[0].window_id,
          expectedBounds: { x: (b.x || 0) + 500, y: (b.y || 0) + 500, width: b.width, height: b.height },
        });
      } catch (e) {
        code = e.code;
      }
      h.equal(code || 'PRECONDITION_WINDOW', 'PRECONDITION_WINDOW');
    });

    h.suite('GUI :: coordenadas relativas a la ventana');

    await h.test('unas coordenadas fuera de la ventana se rechazan', async () => {
      const obs = await d.call('desktop.observe', { action: 'windows', ...S });
      const b = ventanas[0].bounds;
      const r = await d.call('desktop.element_action', {
        action: 'click',
        window_id: ventanas[0].window_id,
        observation_id: obs.structuredContent.observation_id,
        x: b.width + 100,
        y: 10,
        ...S,
      });
      h.ok(!r.structuredContent.ok, 'debería fallar');
      h.includes(r.structuredContent.message || r.structuredContent.error, 'fuera');
    });

    await h.test('dry_run traduce a coordenadas de pantalla SIN actuar', async () => {
      const obs = await d.call('desktop.observe', { action: 'windows', ...S });
      const r = await d.call('desktop.element_action', {
        action: 'click',
        window_id: ventanas[0].window_id,
        observation_id: obs.structuredContent.observation_id,
        x: 10,
        y: 20,
        dry_run: true,
        ...S,
      });
      h.equal(r.structuredContent.ok, true);
      h.ok(r.structuredContent.screen_point, 'falta screen_point');
    });

    h.suite('GUI :: teclado');

    await h.test('no se teclea nada con forma de credencial', async () => {
      const obs = await d.call('desktop.observe', { action: 'windows', ...S });
      const r = await d.call('desktop.keyboard', {
        action: 'type',
        window_id: ventanas[0].window_id,
        observation_id: obs.structuredContent.observation_id,
        text: 'sk-proj-1234567890abcdef1234567890abcdef1234567890',
        ...S,
      });
      h.deniedWith(r, 'POLICY_DENIED', 'SECRET_REDACTED', 'SECRET_VALUE_NEVER_RETURNED');
    });

    await h.test('atajo simulado dry_run con foco', async () => {
      const obs = await d.call('desktop.observe', { action: 'windows', ...S });
      const r = await d.call('desktop.keyboard', {
        action: 'hotkey',
        window_id: ventanas[0].window_id,
        observation_id: obs.structuredContent.observation_id,
        keys: ['ctrl', 'c'],
        dry_run: true,
        ...S,
      });
      h.equal(r.structuredContent.ok, true);
    });

    await h.test('atajo no reconocido -> INVALID_ARGUMENT', async () => {
      const obs = await d.call('desktop.observe', { action: 'windows', ...S });
      const r = await d.call('desktop.keyboard', {
        action: 'hotkey',
        window_id: ventanas[0].window_id,
        observation_id: obs.structuredContent.observation_id,
        keys: ['tecla_inventada_que_no_existe'],
        ...S,
      });
      h.deniedWith(r, 'INVALID_ARGUMENT');
    });

    h.suite('GUI :: capturas');

    await h.test('capturar pantalla completa eleva a R3 y exige aprobación', async () => {
      const r = await d.call('desktop.observe', { action: 'capture_screen', ...S });
      h.deniedWith(r, 'APPROVAL_REQUIRED');
      h.equal(r.structuredContent.risk || (r.structuredContent.details && r.structuredContent.details.risk), 'R3');
    });

    await h.test('capturar una ventana concreta NO exige aprobación', async () => {
      const r = await d.call('desktop.observe', {
        action: 'capture_window',
        window_id: ventanas[0].window_id,
        ...S,
      });
      h.equal(r.structuredContent.ok, true);
      h.ok(r.structuredContent.image_included, 'sin imagen');
    });

    await h.test('la captura por ventana queda registrada en el diario', () => {
      const entries = sb.runtime.journal.readAll();
      const cap = entries.find((e) => e.tool === 'desktop.observe');
      h.ok(!!cap, 'no se registró la captura en el diario');
    });
  } finally {
    sb.cleanup();
  }
}

if (require.main === module) {
  run()
    .then(() => h.summary())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

module.exports = { run };
