'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULT_POLICY, HARD_CEILINGS, INVARIANTS } = require('./defaults');
const { parseRisk, RISK_NAMES } = require('../risk');

/**
 * Carga y valida la política.
 *
 * Orden de precedencia (de menor a mayor):
 *   1. DEFAULT_POLICY (compilada, inmutable)
 *   2. archivo de política en disco (editado SÓLO por una persona)
 *   3. variables de entorno de arranque (editadas SÓLO por una persona)
 *
 * Ninguna herramienta puede escribir en el archivo de política: vive en el
 * directorio de control, que la capa de rutas excluye explícitamente.
 *
 * Falla cerrado: si el archivo existe pero es inválido, el servidor NO arranca.
 */

function deepMerge(base, override) {
  if (Array.isArray(override)) return override.slice();
  if (override === null || typeof override !== 'object') return override;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in out && typeof out[k] === 'object' && out[k] !== null && !Array.isArray(out[k])
      ? deepMerge(out[k], v)
      : deepMerge(out[k], v);
  }
  return out;
}

function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  const last = keys.pop();
  let cur = obj;
  for (const k of keys) {
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[last] = value;
}

function validate(policy) {
  const errors = [];
  const warnings = [];

  if (policy.schema_version !== 1) {
    errors.push(`schema_version no soportada: ${policy.schema_version} (se espera 1)`);
  }
  if (!Array.isArray(policy.profiles) || policy.profiles.length === 0) {
    errors.push('profiles debe ser una lista no vacía');
  }
  for (const key of ['max_risk', 'anonymous_max_risk']) {
    try {
      parseRisk(policy[key]);
    } catch (e) {
      errors.push(`${key} inválido: ${policy[key]} (valores: ${RISK_NAMES.join(', ')})`);
    }
  }
  try {
    parseRisk(policy.approval.required_at_or_above);
  } catch (e) {
    errors.push(`approval.required_at_or_above inválido: ${policy.approval.required_at_or_above}`);
  }

  // Invariantes no desactivables.
  for (const [dotted, required] of Object.entries(INVARIANTS)) {
    const actual = getPath(policy, dotted);
    if (actual !== required) {
      errors.push(`invariante violada: ${dotted} debe ser ${JSON.stringify(required)} (se recibió ${JSON.stringify(actual)})`);
    }
  }

  // Techos absolutos: se recortan y se avisa.
  for (const [dotted, ceiling] of Object.entries(HARD_CEILINGS)) {
    const actual = getPath(policy, dotted);
    if (typeof actual === 'number' && actual > ceiling) {
      warnings.push(`${dotted}=${actual} supera el techo ${ceiling}; se recorta`);
      setPath(policy, dotted, ceiling);
    }
  }

  // Destinos de red.
  for (const d of policy.network.destinations || []) {
    if (!d.alias || !d.origin) {
      errors.push(`destino de red sin alias u origin: ${JSON.stringify(d)}`);
      continue;
    }
    let u;
    try {
      u = new URL(d.origin);
    } catch (e) {
      errors.push(`origin inválido en destino '${d.alias}': ${d.origin}`);
      continue;
    }
    if (u.protocol !== 'https:' && !policy.network.allow_private) {
      errors.push(`el destino '${d.alias}' no usa https y allow_private está desactivado`);
    }
    if (u.pathname !== '/' || u.search || u.hash) {
      errors.push(`el destino '${d.alias}' debe ser sólo origen (esquema://host[:puerto]), sin ruta`);
    }
    if (!Array.isArray(d.methods) || d.methods.length === 0) {
      errors.push(`el destino '${d.alias}' debe declarar métodos permitidos`);
    }
  }

  if (policy.profiles.includes('admin')) {
    warnings.push('el perfil "admin" está ACTIVO: se expone admin.perform_allowlisted_action (R3/R4)');
  }
  if (policy.max_risk === 'R4') {
    warnings.push('max_risk=R4: se permite privilegio general. Esto anula la mayoría de garantías.');
  }
  if ((policy.secrets.allowed || []).length > 0) {
    warnings.push(`SecretBroker habilitado para: ${policy.secrets.allowed.join(', ')} (sólo inyección, nunca lectura)`);
  }

  return { errors, warnings };
}

function applyEnvOverrides(policy, env) {
  if (env.GHOSTPC_PROFILES) {
    policy.profiles = env.GHOSTPC_PROFILES.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (env.GHOSTPC_MAX_RISK) policy.max_risk = env.GHOSTPC_MAX_RISK.trim().toUpperCase();
  if (env.GHOSTPC_APPROVAL_AT) policy.approval.required_at_or_above = env.GHOSTPC_APPROVAL_AT.trim().toUpperCase();
  if (env.GHOSTPC_SECRETS) {
    policy.secrets.allowed = env.GHOSTPC_SECRETS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (env.GHOSTPC_NET_DESTINATIONS) {
    // formato: alias=https://host[|GET,POST];alias2=...
    const extra = [];
    for (const chunk of env.GHOSTPC_NET_DESTINATIONS.split(';')) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const alias = trimmed.slice(0, eq).trim();
      const rest = trimmed.slice(eq + 1).trim();
      const [origin, methods] = rest.split('|');
      extra.push({
        alias,
        origin: origin.trim(),
        methods: methods ? methods.split(',').map((m) => m.trim().toUpperCase()) : ['GET'],
      });
    }
    if (extra.length) policy.network.destinations = policy.network.destinations.concat(extra);
  }
  return policy;
}

/**
 * @returns {{policy:object, source:string, warnings:string[]}}
 * @throws si la política de disco es inválida (falla cerrado)
 */
function loadPolicy({ policyFile, env = process.env } = {}) {
  let policy = JSON.parse(JSON.stringify(DEFAULT_POLICY));
  let source = 'defaults';

  if (policyFile && fs.existsSync(policyFile)) {
    let onDisk;
    try {
      onDisk = JSON.parse(fs.readFileSync(policyFile, 'utf-8'));
    } catch (e) {
      throw new Error(
        `La política en ${policyFile} no es JSON válido: ${e.message}. ` +
        'GhostPC falla cerrado y no arranca con una política ilegible.'
      );
    }
    policy = deepMerge(policy, onDisk);
    source = policyFile;
  }

  policy = applyEnvOverrides(policy, env);

  const { errors, warnings } = validate(policy);
  if (errors.length) {
    throw new Error(
      `Política inválida (${source}):\n  - ${errors.join('\n  - ')}\n` +
      'GhostPC falla cerrado y no arranca con una política inválida.'
    );
  }

  Object.freeze(policy.secrets);
  return { policy, source, warnings };
}

/** Escribe una plantilla de política editable por la persona. */
function writeTemplate(targetFile) {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  const template = {
    _README: [
      'Política de GhostPC. Sólo la edita una persona.',
      'Ninguna herramienta MCP puede leer ni escribir este archivo (está en el directorio de control).',
      'Los valores omitidos heredan de src/core/policy/defaults.js.',
      'Los límites que superen HARD_CEILINGS se recortan automáticamente con aviso.',
    ],
    schema_version: 1,
    profiles: DEFAULT_POLICY.profiles,
    max_risk: DEFAULT_POLICY.max_risk,
    approval: { required_at_or_above: DEFAULT_POLICY.approval.required_at_or_above },
    secrets: { allowed: [], never_return_values: true },
    network: { destinations: DEFAULT_POLICY.network.destinations },
  };
  fs.writeFileSync(targetFile, JSON.stringify(template, null, 2), 'utf-8');
  return targetFile;
}

module.exports = { loadPolicy, validate, writeTemplate, deepMerge };
