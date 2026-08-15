'use strict';

const { GhostError, CODES } = require('../errors');

/**
 * Únicos códigos que abren el circuit breaker: fallos de EJECUCIÓN reales.
 * Todo lo demás (denegaciones, validación, conflictos de revisión, precondiciones)
 * son respuestas correctas del sistema con remediación explícita.
 */
const BREAKER_WORTHY = new Set([CODES.INTERNAL, CODES.TIMEOUT]);

/**
 * Métricas por herramienta + circuit breaker.
 *
 * El breaker existe para que un bucle del agente (misma herramienta fallando una
 * y otra vez) no acabe machacando el sistema. Se abre tras N fallos consecutivos
 * y se cierra sola tras un periodo de enfriamiento.
 */

class Metrics {
  constructor({ failureThreshold = 5, cooldownMs = 60_000 } = {}) {
    this.tools = new Map();
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.startedAt = Date.now();
    this.counters = {
      calls: 0,
      denied: 0,
      approvals_requested: 0,
      secrets_blocked: 0,
      rollbacks: 0,
      stale_memory_detected: 0,
    };
  }

  _entry(tool) {
    if (!this.tools.has(tool)) {
      this.tools.set(tool, {
        tool,
        calls: 0,
        ok: 0,
        errors: 0,
        denied: 0,
        consecutive_failures: 0,
        total_ms: 0,
        max_ms: 0,
        breaker_open_until: 0,
        last_error: null,
      });
    }
    return this.tools.get(tool);
  }

  /** Lanza CIRCUIT_OPEN si la herramienta está en enfriamiento. */
  assertClosed(tool) {
    const e = this._entry(tool);
    if (e.breaker_open_until > Date.now()) {
      const secs = Math.ceil((e.breaker_open_until - Date.now()) / 1000);
      throw new GhostError(
        CODES.CIRCUIT_OPEN,
        `'${tool}' ha fallado ${e.consecutive_failures} veces seguidas; en enfriamiento ${secs}s.`,
        {
          recoverable: true,
          remediation:
            'Cambia una condición antes de reintentar (otros argumentos, otra herramienta o corrige la causa). No repitas la misma llamada.',
          details: { last_error: e.last_error, retry_after_s: secs },
        }
      );
    }
  }

  record(tool, { ok, ms, denied = false, errorCode = null }) {
    const e = this._entry(tool);
    e.calls++;
    this.counters.calls++;
    e.total_ms += ms;
    if (ms > e.max_ms) e.max_ms = ms;
    if (denied) {
      e.denied++;
      this.counters.denied++;
    }
    if (ok) {
      e.ok++;
      e.consecutive_failures = 0;
    } else {
      e.errors++;
      e.last_error = errorCode;
      // El breaker existe para frenar TRABAJO REAL que falla una y otra vez, no
      // para castigar intentos denegados. Una denegación de política o un
      // argumento inválido no ejecutaron nada: ya llevan su propia explicación
      // y bloquearlas 60s sólo empeoraría la experiencia sin añadir seguridad.
      const breakerWorthy = BREAKER_WORTHY.has(errorCode);
      if (breakerWorthy) {
        e.consecutive_failures++;
        if (e.consecutive_failures >= this.failureThreshold) {
          e.breaker_open_until = Date.now() + this.cooldownMs;
        }
      }
    }
  }

  bump(counter, n = 1) {
    if (this.counters[counter] === undefined) this.counters[counter] = 0;
    this.counters[counter] += n;
  }

  snapshot() {
    const perTool = [...this.tools.values()].map((e) => ({
      tool: e.tool,
      calls: e.calls,
      ok: e.ok,
      errors: e.errors,
      denied: e.denied,
      avg_ms: e.calls ? Math.round(e.total_ms / e.calls) : 0,
      max_ms: e.max_ms,
      breaker_open: e.breaker_open_until > Date.now(),
    }));
    perTool.sort((a, b) => b.calls - a.calls);
    return {
      uptime_s: Math.round((Date.now() - this.startedAt) / 1000),
      counters: { ...this.counters },
      tools: perTool,
    };
  }
}

module.exports = { Metrics, BREAKER_WORTHY };
