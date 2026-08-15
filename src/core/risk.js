'use strict';

/**
 * Niveles de riesgo de Jericho.
 *
 * El nivel lo declara el catálogo de herramientas y lo puede ELEVAR el PolicyEngine
 * en función de los efectos concretos de la llamada (p. ej. una escritura fuera del
 * proyecto activo). Nunca lo puede rebajar un argumento del modelo.
 */
const RISK = {
  R0: 0, // lectura local segura dentro de una raíz autorizada
  R1: 1, // cambio reversible dentro del proyecto (hay rollback o historial)
  R2: 2, // efecto externo o difícil de revertir (red, GUI, procesos)
  R3: 3, // destructivo, credenciales, Git remoto o cambios de sistema
  R4: 4, // privilegio general (shell libre, admin). Desactivado por defecto.
};

const RISK_NAMES = ['R0', 'R1', 'R2', 'R3', 'R4'];

function riskName(level) {
  return RISK_NAMES[level] || `R?(${level})`;
}

function parseRisk(value) {
  if (typeof value === 'number') return value;
  const idx = RISK_NAMES.indexOf(String(value).toUpperCase());
  if (idx < 0) throw new Error(`Nivel de riesgo desconocido: ${value}`);
  return idx;
}

/** El nivel efectivo es siempre el máximo entre el declarado y los observados. */
function maxRisk(...levels) {
  return levels.reduce((a, b) => (b > a ? b : a), RISK.R0);
}

module.exports = { RISK, RISK_NAMES, riskName, parseRisk, maxRisk };
