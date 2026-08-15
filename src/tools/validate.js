'use strict';

const { GhostError, CODES } = require('../core/errors');

/**
 * Validador de un subconjunto de JSON Schema, suficiente para los esquemas del
 * catálogo y con el comportamiento que necesitamos:
 *
 *  - `additionalProperties: false` se APLICA de verdad (el prototipo aceptaba
 *    alias no declarados como `targetPath`, así que el esquema publicado no
 *    describía lo que el servidor aceptaba).
 *  - Los mensajes de error indican la ruta exacta del campo.
 *
 * Se usa para validar la entrada ANTES de ejecutar y la salida ANTES de responder.
 */

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, expected) {
  const actual = typeOf(value);
  if (Array.isArray(expected)) return expected.some((t) => matchesType(value, t));
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  if (expected === 'integer') return actual === 'integer';
  return actual === expected;
}

function validate(schema, value, pathStr = '', errors = [], opts = {}) {
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${pathStr || '(raíz)'}: se esperaba ${Array.isArray(schema.type) ? schema.type.join('|') : schema.type}, se recibió ${typeOf(value)}`);
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${pathStr}: valor no permitido ${JSON.stringify(value)}; admitidos: ${schema.enum.join(', ')}`);
  }

  if (typeOf(value) === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${pathStr}: longitud mínima ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${pathStr}: longitud máxima ${schema.maxLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${pathStr}: no cumple el patrón ${schema.pattern}`);
    }
  }

  if (typeOf(value) === 'number' || typeOf(value) === 'integer') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${pathStr}: mínimo ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${pathStr}: máximo ${schema.maximum}`);
  }

  if (typeOf(value) === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${pathStr}: se requieren al menos ${schema.minItems} elementos`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${pathStr}: máximo ${schema.maxItems} elementos`);
    }
    if (schema.items) {
      value.forEach((v, i) => validate(schema.items, v, `${pathStr}[${i}]`, errors, opts));
    }
  }

  if (typeOf(value) === 'object') {
    const props = schema.properties || {};
    const required = new Set(schema.required || []);
    for (const req of required) {
      if (value[req] === undefined) errors.push(`${pathStr ? pathStr + '.' : ''}${req}: campo obligatorio ausente`);
    }
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) {
        // En la SALIDA, null en un campo opcional significa "no aplica a esta
        // llamada" (p. ej. previous_head en el primer commit). En la ENTRADA no
        // se admite: ahí el esquema se aplica al pie de la letra.
        // `undefined` es siempre ausencia. `null` sólo cuenta como ausencia en
        // la salida (ver checkOutput): significa "no aplica a esta llamada".
        if (v === undefined && !required.has(k)) continue;
        if (opts.nullMeansAbsent && v === null && !required.has(k)) continue;
        validate(props[k], v, `${pathStr ? pathStr + '.' : ''}${k}`, errors, opts);
      } else if (schema.additionalProperties === false) {
        errors.push(
          `${pathStr ? pathStr + '.' : ''}${k}: propiedad no declarada en el esquema` +
            (Object.keys(props).length ? ` (admitidas: ${Object.keys(props).join(', ')})` : '')
        );
      } else if (typeof schema.additionalProperties === 'object') {
        validate(schema.additionalProperties, v, `${pathStr ? pathStr + '.' : ''}${k}`, errors, opts);
      }
    }
  }

  return errors;
}

function assertValidInput(schema, value, toolName) {
  const errors = validate(schema, value === undefined ? {} : value);
  if (errors.length) {
    throw new GhostError(CODES.INVALID_ARGUMENT, `Argumentos inválidos para '${toolName}':\n  - ${errors.join('\n  - ')}`, {
      recoverable: true,
      details: { errors },
      remediation: 'Corrige los argumentos según el inputSchema publicado. No se aceptan campos no declarados.',
    });
  }
  return value;
}

function checkOutput(schema, value) {
  return validate(schema, value, '', [], { nullMeansAbsent: true });
}

module.exports = { validate, assertValidInput, checkOutput };
