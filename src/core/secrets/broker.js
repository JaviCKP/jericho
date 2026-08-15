'use strict';

const { GhostError, CODES } = require('../errors');
const redact = require('../redact');

/**
 * SecretBroker.
 *
 * Invariante absoluta: el VALOR de un secreto nunca vuelve al modelo.
 * El broker sólo permite:
 *   - listar los NOMBRES de los secretos autorizados;
 *   - comprobar disponibilidad;
 *   - inyectar un secreto directamente en el entorno de un proceso hijo;
 *   - registrar qué secreto se usó, sin registrar su valor.
 *
 * La única API que devuelve valores (`materializeForProcess`) es de uso interno
 * del runner de procesos y está marcada para que las pruebas estructurales
 * comprueben que ninguna herramienta la invoca.
 */

class SecretBroker {
  constructor({ allowed = [], env = process.env, journal = null, metrics = null } = {}) {
    this.allowed = new Set(allowed);
    this.env = env;
    this.journal = journal;
    this.metrics = metrics;
    this.usageLog = [];
    // Todo secreto autorizado se registra en la capa de redacción, de forma que
    // si alguna vez apareciese en un stdout, un diff o un log, saldría tachado.
    for (const name of this.allowed) {
      const v = this.env[name];
      if (typeof v === 'string' && v.length >= 8) redact.registerSecretValue(v);
    }
  }

  /** Nombres autorizados y si están disponibles. Nunca valores. */
  list() {
    return [...this.allowed].map((name) => ({
      name,
      available: typeof this.env[name] === 'string' && this.env[name].length > 0,
    }));
  }

  isAvailable(name) {
    return this.allowed.has(name) && typeof this.env[name] === 'string' && this.env[name].length > 0;
  }

  _assertAllowed(name) {
    if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
      throw new GhostError(CODES.INVALID_ARGUMENT, 'El nombre de secreto debe ser MAYUSCULAS_CON_GUION_BAJO.');
    }
    if (!this.allowed.has(name)) {
      if (this.metrics) this.metrics.bump('secrets_blocked');
      throw new GhostError(
        CODES.SECRET_NOT_ALLOWED,
        `El secreto '${name}' no está en la lista autorizada.`,
        {
          details: { allowed: [...this.allowed] },
          remediation: 'Una persona debe añadirlo a secrets.allowed en la política. El agente no puede hacerlo.',
        }
      );
    }
    if (!this.isAvailable(name)) {
      throw new GhostError(CODES.SECRET_NOT_AVAILABLE, `El secreto '${name}' está autorizado pero no definido en el entorno.`);
    }
  }

  /**
   * Comprueba que un secreto se puede usar, SIN devolver su valor.
   * Se llama antes de la decisión de política para fallar con el error correcto.
   */
  assertUsable(name) {
    this._assertAllowed(name);
    return true;
  }

  /**
   * USO INTERNO DEL RUNNER DE PROCESOS.
   * Devuelve un objeto de entorno con los secretos pedidos. Nunca debe llegar
   * a una respuesta hacia el modelo.
   * @internal
   */
  materializeForProcess(names = [], context = {}) {
    const out = {};
    for (const name of names) {
      this._assertAllowed(name);
      out[name] = this.env[name];
      const record = {
        secret_name: name,
        at: new Date().toISOString(),
        tool: context.tool || null,
        trace_id: context.trace_id || null,
        program: context.program || null,
      };
      this.usageLog.push(record);
      if (this.journal) {
        this.journal.append({ kind: 'secret.injected', ...record });
      }
    }
    return out;
  }

  /** Historial de uso: qué secreto, cuándo y para qué. Sin valores. */
  usage() {
    return this.usageLog.slice(-200);
  }

  /**
   * Cortafuegos final: comprueba que un payload de salida no contiene ningún
   * valor de secreto autorizado. Lo usa el dispatcher antes de responder.
   */
  assertNoLeak(text, where = 'respuesta') {
    for (const name of this.allowed) {
      const v = this.env[name];
      if (typeof v === 'string' && v.length >= 8 && typeof text === 'string' && text.includes(v)) {
        if (this.metrics) this.metrics.bump('secrets_blocked');
        throw new GhostError(
          CODES.SECRET_VALUE_NEVER_RETURNED,
          `Se bloqueó una ${where} que contenía el valor del secreto '${name}'.`,
          { details: { secret: name } }
        );
      }
    }
    return true;
  }
}

module.exports = { SecretBroker };
