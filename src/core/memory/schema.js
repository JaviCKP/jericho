'use strict';

const { GhostError, CODES } = require('../errors');

/**
 * Esquema versionado de la memoria v2.
 *
 * El Markdown deja de ser la fuente de verdad: pasa a ser una VISTA derivada.
 * La fuente es JSON validado, con revisión y historial.
 */

const SCHEMA_VERSION = 2;

const WORK_ITEM_STATUS = ['DRAFT', 'IN_PROGRESS', 'BLOCKED', 'PAUSED', 'COMPLETED', 'ABANDONED'];
const EVIDENCE_KINDS = ['command', 'test', 'file_hash', 'patch', 'observation', 'manual'];
const FACT_VOLATILITY = ['stable', 'volatile'];

function fail(message, details) {
  throw new GhostError(CODES.SCHEMA_INVALID, message, { details, recoverable: true });
}

function isStr(v) {
  return typeof v === 'string';
}

function assertArrayOf(value, name, validator) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${name} debe ser una lista.`);
  value.forEach((item, i) => validator(item, `${name}[${i}]`));
  return value;
}

/** Plantilla vacía de work item. */
function emptyWorkItem(overrides = {}) {
  const now = new Date().toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    id: null,
    revision: 0,
    project_id: null,
    status: 'DRAFT',
    title: '',
    goal: '',
    acceptance_criteria: [],
    plan: [],
    completed_steps: [],
    next_action: '',
    blockers: [],
    related_files: [],
    branch: null,
    base_commit: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
    verified_facts: [],
    assumptions: [],
    evidence: [],
    author: null,
    session_id: null,
    ...overrides,
  };
}

function validateCriterion(c, where) {
  if (!c || typeof c !== 'object') fail(`${where} debe ser un objeto.`);
  if (!isStr(c.id) || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(c.id)) {
    fail(`${where}.id debe ser un identificador corto [a-z0-9_-].`);
  }
  if (!isStr(c.text) || c.text.trim().length < 3) fail(`${where}.text es obligatorio.`);
  if (c.mandatory !== undefined && typeof c.mandatory !== 'boolean') fail(`${where}.mandatory debe ser booleano.`);
  if (c.verify !== undefined && !isStr(c.verify)) fail(`${where}.verify debe ser texto.`);
}

function validateEvidence(e, where) {
  if (!e || typeof e !== 'object') fail(`${where} debe ser un objeto.`);
  if (!isStr(e.criterion_id)) fail(`${where}.criterion_id es obligatorio.`);
  if (!EVIDENCE_KINDS.includes(e.kind)) {
    fail(`${where}.kind debe ser uno de: ${EVIDENCE_KINDS.join(', ')}.`);
  }
  if (!['pass', 'fail'].includes(e.result)) fail(`${where}.result debe ser 'pass' o 'fail'.`);
  if (!isStr(e.at)) fail(`${where}.at (timestamp ISO) es obligatorio.`);
  if (e.kind !== 'manual' && !isStr(e.trace_id)) {
    fail(`${where}.trace_id es obligatorio para evidencia de tipo '${e.kind}' (debe apuntar a una operación real del diario).`);
  }
}

function validateFact(f, where) {
  if (!f || typeof f !== 'object') fail(`${where} debe ser un objeto.`);
  if (!isStr(f.text) || f.text.trim().length === 0) fail(`${where}.text es obligatorio.`);
  if (f.volatility !== undefined && !FACT_VOLATILITY.includes(f.volatility)) {
    fail(`${where}.volatility debe ser 'stable' o 'volatile'.`);
  }
  if (f.verified_at !== undefined && !isStr(f.verified_at)) fail(`${where}.verified_at debe ser texto ISO.`);
}

/** Valida un work item completo. Lanza SCHEMA_INVALID si no cumple. */
function validateWorkItem(item) {
  if (!item || typeof item !== 'object') fail('El work item debe ser un objeto.');
  if (item.schema_version !== SCHEMA_VERSION) {
    fail(`schema_version no soportada: ${item.schema_version} (se espera ${SCHEMA_VERSION}).`, {
      got: item.schema_version,
      expected: SCHEMA_VERSION,
    });
  }
  if (!isStr(item.id) || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(item.id)) {
    fail('id debe ser un identificador estable [a-z0-9._-] de hasta 128 caracteres.');
  }
  if (!Number.isInteger(item.revision) || item.revision < 0) fail('revision debe ser un entero >= 0.');
  if (!isStr(item.project_id) || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(item.project_id)) {
    fail('project_id debe ser un identificador [a-z0-9._-].');
  }
  if (!WORK_ITEM_STATUS.includes(item.status)) {
    fail(`status debe ser uno de: ${WORK_ITEM_STATUS.join(', ')}.`);
  }
  if (!isStr(item.title) || item.title.trim().length === 0) fail('title es obligatorio.');
  if (!isStr(item.goal)) fail('goal debe ser texto.');
  if (!isStr(item.next_action)) fail('next_action debe ser texto.');

  assertArrayOf(item.acceptance_criteria, 'acceptance_criteria', validateCriterion);
  assertArrayOf(item.evidence, 'evidence', validateEvidence);
  assertArrayOf(item.verified_facts, 'verified_facts', validateFact);
  assertArrayOf(item.assumptions, 'assumptions', (a, w) => {
    if (!isStr(a)) fail(`${w} debe ser texto.`);
  });
  assertArrayOf(item.plan, 'plan', (p, w) => {
    if (!isStr(p)) fail(`${w} debe ser texto.`);
  });
  assertArrayOf(item.completed_steps, 'completed_steps', (p, w) => {
    if (!isStr(p)) fail(`${w} debe ser texto.`);
  });
  assertArrayOf(item.blockers, 'blockers', (p, w) => {
    if (!isStr(p)) fail(`${w} debe ser texto.`);
  });
  assertArrayOf(item.related_files, 'related_files', (p, w) => {
    if (!isStr(p)) fail(`${w} debe ser una ruta relativa en texto.`);
  });

  // Las criterion_id de la evidencia deben existir.
  const critIds = new Set((item.acceptance_criteria || []).map((c) => c.id));
  for (const e of item.evidence || []) {
    if (!critIds.has(e.criterion_id)) {
      fail(`La evidencia apunta a un criterio inexistente: '${e.criterion_id}'.`, {
        known_criteria: [...critIds],
      });
    }
  }
  return item;
}

/**
 * Comprueba si un work item puede pasar a COMPLETED.
 *
 * Requiere que TODOS los criterios obligatorios tengan al menos una evidencia
 * con result='pass'. Si `traceExists` se suministra, además se verifica que el
 * trace_id de la evidencia corresponde a una operación realmente registrada en
 * el diario: así el modelo no puede inventarse la evidencia.
 *
 * @returns {{ok:boolean, missing:Array, unverifiable:Array}}
 */
function checkCompletionEvidence(item, traceExists = null) {
  const mandatory = (item.acceptance_criteria || []).filter((c) => c.mandatory !== false);
  const missing = [];
  const unverifiable = [];

  if (mandatory.length === 0) {
    return {
      ok: false,
      missing: [{ id: '(ninguno)', text: 'El work item no declara ningún criterio de aceptación obligatorio.' }],
      unverifiable: [],
    };
  }

  for (const c of mandatory) {
    const passing = (item.evidence || []).filter((e) => e.criterion_id === c.id && e.result === 'pass');
    if (passing.length === 0) {
      missing.push({ id: c.id, text: c.text, verify: c.verify || null });
      continue;
    }
    if (traceExists) {
      const anyReal = passing.some((e) => e.kind === 'manual' || (e.trace_id && traceExists(e.trace_id)));
      if (!anyReal) {
        unverifiable.push({
          id: c.id,
          text: c.text,
          reason: 'ninguna evidencia apunta a una operación registrada en el diario de auditoría',
          trace_ids: passing.map((e) => e.trace_id),
        });
      }
    }
  }
  return { ok: missing.length === 0 && unverifiable.length === 0, missing, unverifiable };
}

module.exports = {
  SCHEMA_VERSION,
  WORK_ITEM_STATUS,
  EVIDENCE_KINDS,
  FACT_VOLATILITY,
  emptyWorkItem,
  validateWorkItem,
  checkCompletionEvidence,
};
