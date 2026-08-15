'use strict';

const crypto = require('crypto');

/**
 * Identificadores explícitos.
 *
 * REGLA: la conexión MCP NUNCA es la identidad de sesión. Toda operación con
 * estado duradero exige un `session_id` explícito suministrado por el cliente.
 * Si el cliente no lo suministra, el servidor usa una sesión anónima *marcada*
 * como tal, que la política puede restringir a R0/R1.
 */

const ANONYMOUS_SESSION = 'anon';

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

const newTraceId = () => newId('trc');
const newSessionId = () => newId('ses');
const newApprovalId = () => newId('apr');
const newWorkItemId = () => newId('wi');
const newProcId = () => newId('proc');

/** Valida un id suministrado por el cliente. Evita inyección en rutas y logs. */
function validateExternalId(value, label = 'id') {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`${label} debe ser una cadena`);
  const v = value.trim();
  if (v.length === 0) return null;
  if (v.length > 128) throw new Error(`${label} demasiado largo (máx. 128)`);
  if (!/^[A-Za-z0-9._:-]+$/.test(v)) {
    throw new Error(`${label} sólo admite [A-Za-z0-9._:-]`);
  }
  return v;
}

/**
 * Huella estable de una operación. Vincula una aprobación a EXACTAMENTE
 * la operación aprobada: aprobar una cosa no autoriza otra.
 *
 * `approval_id` se excluye a propósito: la huella se calcula la primera vez SIN
 * él (aún no existe) y se vuelve a calcular al reintentar CON él. Si contara,
 * jamás coincidiría y ninguna aprobación funcionaría.
 */
const FINGERPRINT_IGNORED = new Set(['approval_id']);

function fingerprint(tool, args, extra = {}) {
  const relevant = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (!FINGERPRINT_IGNORED.has(k)) relevant[k] = v;
  }
  const canonical = JSON.stringify({ tool, args: sortDeep(relevant), extra: sortDeep(extra) });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortDeep(value[k]);
    return out;
  }
  return value;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

module.exports = {
  ANONYMOUS_SESSION,
  newId,
  newTraceId,
  newSessionId,
  newApprovalId,
  newWorkItemId,
  newProcId,
  validateExternalId,
  fingerprint,
  sortDeep,
  sha256,
};
