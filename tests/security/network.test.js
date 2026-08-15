'use strict';

/**
 * Red: SSRF, redirecciones, exfiltración y allowlist de destinos.
 *
 * En v1, `http_request` aceptaba cualquier URL con cualquier método, cuerpo y
 * cabeceras: se comprobó que alcanzaba loopback y hacía POST al exterior (P0-5).
 */

const http = require('http');
const h = require('../harness');
const { makeSandbox } = require('../helpers/sandbox');
const { Dispatcher } = require('../../src/tools/dispatch');
const { IMPLEMENTATIONS } = require('../../src/tools');
const { classifyAddress } = require('../../src/core/net/guard');

async function run() {
  // Servidor local que simula un servicio interno con datos sensibles.
  const internal = http.createServer((req, res) => {
    if (req.url.startsWith('/redirect-external')) {
      res.writeHead(302, { Location: 'https://example.com/' });
      return res.end();
    }
    if (req.url.startsWith('/redirect-internal')) {
      res.writeHead(302, { Location: 'http://127.0.0.1:1/' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('DATOS-INTERNOS-CONFIDENCIALES');
  });
  await new Promise((r) => internal.listen(0, '127.0.0.1', r));
  const internalPort = internal.address().port;

  const sb = makeSandbox({
    policy: {
      schema_version: 1,
      profiles: ['core_read', 'development', 'network'],
      network: {
        destinations: [
          { alias: 'ejemplo', origin: 'https://example.com', methods: ['GET'] },
          { alias: 'ejemplo_post', origin: 'https://example.com', methods: ['GET', 'POST'] },
        ],
        allow_private: false,
        allow_loopback: false,
        fetch_readonly: { enabled: true, schemes: ['https:'], block_private: true },
        egress_requires_approval: true,
        egress_free_bytes: 0,
      },
    },
  });
  const d = new Dispatcher(sb.runtime, IMPLEMENTATIONS);
  const S = { session_id: 'ses_net' };

  try {
    h.suite('red :: clasificación de direcciones');

    for (const [addr, label] of [
      ['127.0.0.1', 'loopback'],
      ['10.1.2.3', 'red privada'],
      ['172.16.0.1', 'red privada'],
      ['172.31.255.254', 'red privada'],
      ['192.168.1.1', 'red privada'],
      ['169.254.169.254', 'metadatos de nube'],
      ['100.64.0.1', 'CGNAT'],
      ['0.0.0.0', 'este host'],
      ['::1', 'loopback IPv6'],
      ['fd00::1', 'ULA IPv6'],
      ['fe80::1', 'enlace local IPv6'],
      ['::ffff:127.0.0.1', 'loopback mapeada a IPv6'],
      ['::ffff:10.0.0.1', 'privada mapeada a IPv6'],
    ]) {
      await h.test(`${addr} se clasifica como bloqueada (${label})`, () => {
        h.equal(classifyAddress(addr).blocked, true);
      });
    }

    await h.test('una IP pública no se bloquea', () => {
      h.equal(classifyAddress('93.184.216.34').blocked, false);
    });

    h.suite('red :: no hay HTTP arbitrario');

    await h.test('http_request de v1 ya no existe', async () => {
      const r = await d.call('http_request', { url: 'https://ejemplo.com', method: 'POST' });
      h.deniedWith(r, 'NOT_FOUND');
      h.includes(r.structuredContent.remediation, 'alias');
    });

    await h.test('http.call_allowlisted rechaza un alias desconocido', async () => {
      const r = await d.call('http.call_allowlisted', { destination: 'cualquiera', path: '/', ...S });
      h.deniedWith(r, 'NET_DESTINATION_DENIED');
    });

    await h.test('rechaza un método no declarado para ese destino', async () => {
      const r = await d.call('http.call_allowlisted', { destination: 'ejemplo', method: 'POST', body: 'x', ...S });
      h.deniedWith(r, 'NET_METHOD_DENIED');
    });

    await h.test('la ruta no puede salir del origen del alias', async () => {
      const r = await d.call('http.call_allowlisted', { destination: 'ejemplo', path: '//evil.com/x', ...S });
      h.equal(r.isError, true);
      h.ok(['NET_DESTINATION_DENIED', 'INVALID_ARGUMENT'].includes(r.structuredContent.error), r.structuredContent.error);
    });

    h.suite('red :: SSRF');

    await h.test('la política NO admite configurar un destino http:// hacia loopback (falla cerrado)', () => {
      const { loadPolicy } = require('../../src/core/policy/loader');
      const fs = require('fs');
      const path = require('path');
      const tmp = path.join(sb.controlDir, 'policy-mala.json');
      fs.writeFileSync(
        tmp,
        JSON.stringify({
          schema_version: 1,
          network: { destinations: [{ alias: 'interno', origin: `http://127.0.0.1:${internalPort}`, methods: ['GET'] }] },
        }),
        'utf-8'
      );
      let lanzo = null;
      try {
        loadPolicy({ policyFile: tmp, env: {} });
      } catch (e) {
        lanzo = e.message;
      }
      h.ok(lanzo, 'la política inválida se aceptó');
      h.includes(lanzo, 'no usa https');
    });

    await h.test('la guardia de red bloquea un host que resuelve a loopback', async () => {
      let code = null;
      try {
        await sb.runtime.net.assertHostAllowed('localhost');
      } catch (e) {
        code = e.code;
      }
      h.equal(code, 'NET_PRIVATE_ADDRESS');
    });

    await h.test('la guardia de red bloquea una IP privada literal', async () => {
      let code = null;
      try {
        await sb.runtime.net.assertHostAllowed('10.0.0.5');
      } catch (e) {
        code = e.code;
      }
      h.equal(code, 'NET_PRIVATE_ADDRESS');
    });

    await h.test('el servidor interno sigue siendo inalcanzable desde las herramientas', async () => {
      const r = await d.call('web.fetch_readonly', { url: `https://127.0.0.1:${internalPort}/`, ...S });
      h.equal(r.isError, true);
      h.excludes(JSON.stringify(r), 'DATOS-INTERNOS-CONFIDENCIALES');
    });

    await h.test('web.fetch_readonly rechaza http:// (sólo https)', async () => {
      const r = await d.call('web.fetch_readonly', { url: `http://127.0.0.1:${internalPort}/`, ...S });
      h.equal(r.isError, true);
      // El patrón del esquema lo rechaza antes incluso de la guardia de red.
      h.ok(['INVALID_ARGUMENT', 'NET_DESTINATION_DENIED'].includes(r.structuredContent.error), r.structuredContent.error);
    });

    await h.test('web.fetch_readonly rechaza https hacia localhost', async () => {
      const r = await d.call('web.fetch_readonly', { url: 'https://localhost/', ...S });
      h.deniedWith(r, 'NET_PRIVATE_ADDRESS');
    });

    await h.test('web.fetch_readonly rechaza https hacia 169.254.169.254 (metadatos)', async () => {
      const r = await d.call('web.fetch_readonly', { url: 'https://169.254.169.254/latest/meta-data/', ...S });
      h.deniedWith(r, 'NET_PRIVATE_ADDRESS');
    });

    await h.test('web.fetch_readonly rechaza credenciales embebidas en la URL', async () => {
      const r = await d.call('web.fetch_readonly', { url: 'https://user:pass@example.com/', ...S });
      h.deniedWith(r, 'NET_DESTINATION_DENIED');
    });

    h.suite('red :: exfiltración');

    await h.test('un cuerpo con rutas del equipo y contains_local_data=false -> POLICY_DENIED', async () => {
      const r = await d.call('http.call_allowlisted', {
        destination: 'ejemplo_post',
        method: 'POST',
        path: '/recoger',
        body: JSON.stringify({ hallazgo: sb.workspace + '/secreto.txt' }),
        contains_local_data: false,
        ...S,
      });
      h.deniedWith(r, 'POLICY_DENIED');
      h.includes(JSON.stringify(r.structuredContent.details), 'raíz');
    });

    await h.test('un cuerpo con una clave privada se detecta como dato local', async () => {
      const r = await d.call('http.call_allowlisted', {
        destination: 'ejemplo_post',
        method: 'POST',
        path: '/recoger',
        body: '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
        contains_local_data: false,
        ...S,
      });
      h.deniedWith(r, 'POLICY_DENIED');
    });

    await h.test('declarar contains_local_data=true eleva a R3 y exige aprobación', async () => {
      const r = await d.call('http.call_allowlisted', {
        destination: 'ejemplo_post',
        method: 'POST',
        path: '/recoger',
        body: 'contenido leído del equipo',
        contains_local_data: true,
        ...S,
      });
      h.deniedWith(r, 'APPROVAL_REQUIRED');
      h.includes(r.structuredContent.details.what_will_happen, 'bytes leídos del equipo');
    });

    h.suite('red :: aprobaciones');

    await h.test('la aprobación está ligada a la operación exacta', async () => {
      const r1 = await d.call('http.call_allowlisted', {
        destination: 'ejemplo_post', method: 'POST', path: '/a', body: 'datos', contains_local_data: true, ...S,
      });
      const id = r1.structuredContent.details.approval_id;
      sb.runtime.approvals.decide(id, true, 'prueba');

      // Se intenta usar esa aprobación para OTRA operación.
      const r2 = await d.call('http.call_allowlisted', {
        destination: 'ejemplo_post', method: 'POST', path: '/otra-ruta', body: 'datos', contains_local_data: true,
        approval_id: id, ...S,
      });
      h.deniedWith(r2, 'APPROVAL_INVALID');
      h.includes(r2.structuredContent.message, 'huella');
    });

    await h.test('una aprobación consumida no se puede reutilizar', async () => {
      const args = { destination: 'ejemplo_post', method: 'POST', path: '/b', body: 'x', contains_local_data: true, ...S };
      const r1 = await d.call('http.call_allowlisted', args);
      const id = r1.structuredContent.details.approval_id;
      sb.runtime.approvals.decide(id, true, 'prueba');
      // dry_run consume la aprobación sin salir a la red.
      const r2 = await d.call('http.call_allowlisted', { ...args, approval_id: id });
      // Puede fallar por red (no hay internet en CI); lo que importa es que
      // la SEGUNDA vez el motivo sea la reutilización.
      const r3 = await d.call('http.call_allowlisted', { ...args, approval_id: id });
      h.deniedWith(r3, 'APPROVAL_INVALID');
      h.ok(/ya se usó|caducó/.test(r3.structuredContent.message), r3.structuredContent.message);
    });

    await h.test('una aprobación denegada no autoriza nada', async () => {
      const args = { destination: 'ejemplo_post', method: 'POST', path: '/c', body: 'x', contains_local_data: true, ...S };
      const r1 = await d.call('http.call_allowlisted', args);
      const id = r1.structuredContent.details.approval_id;
      sb.runtime.approvals.decide(id, false, 'prueba');
      const r2 = await d.call('http.call_allowlisted', { ...args, approval_id: id });
      h.deniedWith(r2, 'APPROVAL_INVALID');
      h.includes(r2.structuredContent.message, 'denegada');
    });

    await h.test('el modelo no puede inventarse un approval_id', async () => {
      const r = await d.call('http.call_allowlisted', {
        destination: 'ejemplo_post', method: 'POST', path: '/d', body: 'x', contains_local_data: true,
        approval_id: 'apr_inventado123', ...S,
      });
      h.deniedWith(r, 'APPROVAL_INVALID');
    });

    h.suite('red :: registro de egreso');

    await h.test('el diario registra destino y bytes de cada intento', () => {
      const entries = sb.runtime.journal
        .readAll()
        .filter((e) => ['tool.call', 'tool.error'].includes(e.kind) && e.tool === 'http.call_allowlisted');
      h.ok(entries.length >= 8, `se esperaban al menos 8 registros, hay ${entries.length}`);
      const denegados = entries.filter((e) => e.kind === 'tool.error');
      h.ok(denegados.length >= 4, 'las denegaciones también deben quedar auditadas');
    });
  } finally {
    internal.close();
    sb.cleanup();
  }
}

if (require.main === module) {
  run().then(() => h.exitWithSummary('SEGURIDAD :: RED'));
}
module.exports = { run };
