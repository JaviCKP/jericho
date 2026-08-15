'use strict';

const dns = require('dns').promises;
const net = require('net');
const { JerichoError, CODES } = require('../errors');
const redact = require('../redact');

/**
 * Guardia de red.
 *
 * - No hay HTTP arbitrario: `http.call_allowlisted` usa ALIAS de destino.
 * - Cada destino declara qué métodos admite.
 * - Se resuelve DNS y se valida CADA dirección IP devuelta antes de conectar.
 * - Se bloquean loopback, redes privadas, enlace local y endpoints de metadatos.
 * - Las redirecciones se siguen a mano y se revalidan una por una.
 * - Límites de tamaño de petición y respuesta, y de tiempo.
 * - Se registra el destino y los bytes enviados.
 */

/* ------------------------- clasificación de direcciones ------------------------- */

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function inCidr4(ip, base, bits) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_V4 = [
  ['0.0.0.0', 8, 'este host'],
  ['10.0.0.0', 8, 'red privada'],
  ['100.64.0.0', 10, 'CGNAT'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'enlace local / metadatos de nube'],
  ['172.16.0.0', 12, 'red privada'],
  ['192.0.0.0', 24, 'asignaciones especiales IETF'],
  ['192.168.0.0', 16, 'red privada'],
  ['198.18.0.0', 15, 'pruebas de rendimiento'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reservado'],
];

/** Endpoints de metadatos conocidos: bloqueados siempre, incluso con allow_private. */
const METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
  '100.100.100.200',
  'fd00:ec2::254',
]);

function classifyAddress(addr) {
  if (net.isIPv4(addr)) {
    for (const [base, bits, label] of BLOCKED_V4) {
      if (inCidr4(addr, base, bits)) return { blocked: true, reason: label, loopback: label === 'loopback' };
    }
    return { blocked: false };
  }
  if (net.isIPv6(addr)) {
    const lower = addr.toLowerCase();
    // IPv4 mapeada -> se evalúa como IPv4.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return classifyAddress(mapped[1]);
    if (lower === '::1' || lower === '::') return { blocked: true, reason: 'loopback', loopback: true };
    const head = lower.split(':')[0];
    if (/^f[cd]/.test(head)) return { blocked: true, reason: 'unique local (fc00::/7)' };
    if (/^fe[89ab]/.test(head)) return { blocked: true, reason: 'enlace local (fe80::/10)' };
    if (/^ff/.test(head)) return { blocked: true, reason: 'multicast' };
    return { blocked: false };
  }
  return { blocked: true, reason: 'dirección no reconocible' };
}

/* ------------------------------- guardia ------------------------------- */

class NetworkGuard {
  constructor({ policy, journal = null, metrics = null }) {
    this.policy = policy;
    this.journal = journal;
    this.metrics = metrics;
    this.destinations = new Map();
    for (const d of policy.network.destinations || []) {
      this.destinations.set(d.alias, { ...d, originUrl: new URL(d.origin) });
    }
    this.egressBytes = 0;
  }

  listDestinations() {
    return [...this.destinations.values()].map((d) => ({
      alias: d.alias,
      origin: d.origin,
      methods: d.methods,
    }));
  }

  _limits() {
    return this.policy.limits.net;
  }

  /** Comprueba que un host resuelve sólo a direcciones permitidas. */
  async assertHostAllowed(hostname, { allowPrivate = false } = {}) {
    const lower = String(hostname).toLowerCase();
    if (METADATA_HOSTS.has(lower)) {
      throw new JerichoError(CODES.NET_PRIVATE_ADDRESS, `Destino de metadatos bloqueado: ${lower}.`);
    }
    if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) {
      if (!allowPrivate) {
        throw new JerichoError(CODES.NET_PRIVATE_ADDRESS, `Nombre de host local bloqueado: ${lower}.`);
      }
    }

    // Un literal de IP no necesita DNS.
    if (net.isIP(lower)) {
      const c = classifyAddress(lower);
      if (c.blocked && !allowPrivate) {
        throw new JerichoError(CODES.NET_PRIVATE_ADDRESS, `Dirección bloqueada (${c.reason}): ${lower}.`);
      }
      return [lower];
    }

    let records;
    try {
      records = await dns.lookup(lower, { all: true, verbatim: true });
    } catch (err) {
      throw new JerichoError(CODES.NET_DESTINATION_DENIED, `No se pudo resolver el host '${lower}': ${err.code || err.message}.`, {
        recoverable: true,
      });
    }
    if (!records.length) {
      throw new JerichoError(CODES.NET_DESTINATION_DENIED, `El host '${lower}' no resolvió a ninguna dirección.`);
    }
    // TODAS las direcciones deben ser válidas: si alguna es privada, se bloquea
    // (defensa frente a DNS rebinding con respuestas mixtas).
    for (const r of records) {
      const c = classifyAddress(r.address);
      if (c.blocked && !allowPrivate) {
        if (METADATA_HOSTS.has(r.address)) {
          throw new JerichoError(CODES.NET_PRIVATE_ADDRESS, `'${lower}' resuelve a un endpoint de metadatos (${r.address}).`);
        }
        throw new JerichoError(
          CODES.NET_PRIVATE_ADDRESS,
          `'${lower}' resuelve a una dirección no permitida (${r.address}: ${c.reason}).`,
          { details: { host: lower, address: r.address, reason: c.reason } }
        );
      }
    }
    return records.map((r) => r.address);
  }

  /**
   * Construye y valida la URL final a partir de un alias y una ruta.
   * El modelo nunca envía una URL completa a `http.call_allowlisted`.
   */
  resolveAliasUrl(alias, pathAndQuery = '/', method = 'GET') {
    const dest = this.destinations.get(alias);
    if (!dest) {
      throw new JerichoError(CODES.NET_DESTINATION_DENIED, `Destino de red desconocido: '${alias}'.`, {
        details: { available: [...this.destinations.keys()] },
        remediation: 'Una persona debe añadir el destino a network.destinations en la política.',
      });
    }
    const m = String(method || 'GET').toUpperCase();
    if (!dest.methods.map((x) => x.toUpperCase()).includes(m)) {
      throw new JerichoError(CODES.NET_METHOD_DENIED, `El método ${m} no está permitido para el destino '${alias}'.`, {
        details: { allowed: dest.methods },
      });
    }
    let rel = String(pathAndQuery || '/');
    if (!rel.startsWith('/')) rel = '/' + rel;
    if (rel.includes('\\') || rel.includes('\0')) {
      throw new JerichoError(CODES.INVALID_ARGUMENT, 'Ruta de destino inválida.');
    }
    const url = new URL(rel, dest.originUrl);
    // La ruta no puede sacarnos del origen declarado.
    if (url.origin !== dest.originUrl.origin) {
      throw new JerichoError(CODES.NET_DESTINATION_DENIED, `La ruta sale del origen autorizado de '${alias}'.`);
    }
    return { url, dest, method: m };
  }

  /** Valida una URL absoluta para `web.fetch_readonly`. */
  assertFetchUrlAllowed(rawUrl) {
    const cfg = this.policy.network.fetch_readonly || {};
    if (!cfg.enabled) {
      throw new JerichoError(CODES.NET_DESTINATION_DENIED, 'web.fetch_readonly está desactivado por política.');
    }
    let url;
    try {
      url = new URL(rawUrl);
    } catch (e) {
      throw new JerichoError(CODES.INVALID_ARGUMENT, 'URL inválida.');
    }
    if (!(cfg.schemes || ['https:']).includes(url.protocol)) {
      throw new JerichoError(CODES.NET_DESTINATION_DENIED, `Esquema no permitido: ${url.protocol} (se exige ${(cfg.schemes || ['https:']).join(', ')}).`);
    }
    if (url.username || url.password) {
      throw new JerichoError(CODES.NET_DESTINATION_DENIED, 'No se permiten credenciales embebidas en la URL.');
    }
    return url;
  }

  /**
   * Petición HTTP con validación completa: DNS, redirecciones, límites y registro.
   *
   * @returns {{status, headers, body, bytes_received, bytes_sent, final_url, redirects}}
   */
  async request({
    url,
    method = 'GET',
    headers = {},
    body = null,
    allowPrivate = false,
    tool = null,
    traceId = null,
    sessionId = null,
    egressClassified = false,
  }) {
    const lim = this._limits();
    const bytesSent = body ? Buffer.byteLength(body) : 0;
    if (bytesSent > lim.max_request_bytes) {
      throw new JerichoError(CODES.NET_LIMIT_EXCEEDED, `Cuerpo de petición de ${bytesSent} bytes; el límite es ${lim.max_request_bytes}.`);
    }

    const redirects = [];
    let current = new URL(url.toString());
    let currentMethod = String(method).toUpperCase();
    let currentBody = body;

    for (let hop = 0; hop <= lim.max_redirects; hop++) {
      await this.assertHostAllowed(current.hostname, { allowPrivate });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), lim.timeout_ms);
      let res;
      try {
        res = await fetch(current, {
          method: currentMethod,
          headers: {
            'User-Agent': 'Jericho/2.0 (+local-agent)',
            Accept: headers.Accept || '*/*',
            ...headers,
          },
          body: currentBody,
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          throw new JerichoError(CODES.TIMEOUT, `La petición a ${redact.redactUrl(current.toString())} superó ${lim.timeout_ms} ms.`, {
            recoverable: true,
          });
        }
        throw new JerichoError(CODES.NET_DESTINATION_DENIED, `Fallo de red: ${err.cause ? err.cause.code || err.cause.message : err.message}`, {
          recoverable: true,
        });
      }
      clearTimeout(timer);

      // Redirección: se revalida el nuevo destino desde cero.
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const loc = res.headers.get('location');
        let next;
        try {
          next = new URL(loc, current);
        } catch (e) {
          throw new JerichoError(CODES.NET_REDIRECT_DENIED, `Redirección con Location inválida: ${loc}`);
        }
        if (hop === lim.max_redirects) {
          throw new JerichoError(CODES.NET_REDIRECT_DENIED, `Se superó el máximo de ${lim.max_redirects} redirecciones.`);
        }
        if (next.protocol !== 'https:' && !allowPrivate) {
          throw new JerichoError(CODES.NET_REDIRECT_DENIED, `Redirección a un esquema no permitido: ${next.protocol}`);
        }
        // Una redirección no puede llevarnos a un destino que no esté autorizado
        // por sí mismo. Se comprueba DNS + rangos en la siguiente vuelta.
        redirects.push({ from: redact.redactUrl(current.toString()), to: redact.redactUrl(next.toString()), status: res.status });
        this._journalHop('net.redirect', { tool, traceId, sessionId, from: current.toString(), to: next.toString(), status: res.status });
        current = next;
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod === 'POST')) {
          currentMethod = 'GET';
          currentBody = null;
        }
        continue;
      }

      // Lectura con tope de bytes.
      const { text, bytes, truncated } = await readCapped(res, lim.max_response_bytes);
      this.egressBytes += bytesSent;
      this._journalHop('net.request', {
        tool,
        traceId,
        sessionId,
        from: null,
        to: current.toString(),
        status: res.status,
        bytes_sent: bytesSent,
        bytes_received: bytes,
        egress_classified: egressClassified,
        redirects: redirects.length,
      });

      return {
        status: res.status,
        status_text: res.statusText,
        headers: redact.redactHeaders(Object.fromEntries(res.headers.entries())),
        body: redact.redactText(text),
        bytes_received: bytes,
        bytes_sent: bytesSent,
        truncated,
        final_url: redact.redactUrl(current.toString()),
        redirects,
      };
    }
    throw new JerichoError(CODES.NET_REDIRECT_DENIED, 'Bucle de redirecciones.');
  }

  _journalHop(kind, data) {
    if (!this.journal) return;
    this.journal.append({
      kind,
      tool: data.tool,
      trace_id: data.traceId,
      session_id: data.sessionId,
      destination: data.to ? redact.redactUrl(data.to) : null,
      from: data.from ? redact.redactUrl(data.from) : undefined,
      status: data.status,
      bytes_sent: data.bytes_sent,
      bytes_received: data.bytes_received,
      egress_classified: data.egress_classified,
      redirects: data.redirects,
    });
  }
}

/** Lee el cuerpo con tope duro de bytes, abortando el flujo al superarlo. */
async function readCapped(res, maxBytes) {
  if (!res.body) {
    const t = await res.text();
    return { text: t.slice(0, maxBytes), bytes: Buffer.byteLength(t), truncated: Buffer.byteLength(t) > maxBytes };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > maxBytes) {
      truncated = true;
      try { await reader.cancel(); } catch (e) { /* ignorado */ }
      break;
    }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { text: buf.toString('utf-8'), bytes, truncated };
}

module.exports = { NetworkGuard, classifyAddress, METADATA_HOSTS };
