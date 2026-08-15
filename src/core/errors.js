'use strict';

/**
 * Errores tipados de GhostPC.
 *
 * `recoverable` indica al modelo si tiene sentido reintentar tras CAMBIAR una condición.
 * Nunca debe reintentarse la misma llamada idéntica ante un error no recuperable.
 */
class GhostError extends Error {
  constructor(code, message, opts = {}) {
    super(message);
    this.name = 'GhostError';
    this.code = code;
    this.recoverable = opts.recoverable === true;
    this.remediation = opts.remediation || null;
    this.details = opts.details || {};
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      remediation: this.remediation,
      details: this.details,
    };
  }
}

const CODES = {
  // política / permisos
  POLICY_DENIED: 'POLICY_DENIED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  APPROVAL_INVALID: 'APPROVAL_INVALID',
  PROFILE_DISABLED: 'PROFILE_DISABLED',
  RISK_LEVEL_DISABLED: 'RISK_LEVEL_DISABLED',
  // workspace
  PATH_OUTSIDE_ROOT: 'PATH_OUTSIDE_ROOT',
  PATH_DENIED: 'PATH_DENIED',
  PATH_LINK_ESCAPE: 'PATH_LINK_ESCAPE',
  PATH_NOT_FOUND: 'PATH_NOT_FOUND',
  ROOT_UNKNOWN: 'ROOT_UNKNOWN',
  // edición
  PRECONDITION_HASH_MISMATCH: 'PRECONDITION_HASH_MISMATCH',
  PATCH_AMBIGUOUS: 'PATCH_AMBIGUOUS',
  PATCH_DID_NOT_APPLY: 'PATCH_DID_NOT_APPLY',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  // memoria
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  LEASE_HELD: 'LEASE_HELD',
  EVIDENCE_MISSING: 'EVIDENCE_MISSING',
  NOT_FOUND: 'NOT_FOUND',
  // ejecución
  COMMAND_NOT_ALLOWED: 'COMMAND_NOT_ALLOWED',
  TIMEOUT: 'TIMEOUT',
  OUTPUT_TRUNCATED: 'OUTPUT_TRUNCATED',
  PROCESS_NOT_OWNED: 'PROCESS_NOT_OWNED',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  // red
  NET_DESTINATION_DENIED: 'NET_DESTINATION_DENIED',
  NET_METHOD_DENIED: 'NET_METHOD_DENIED',
  NET_REDIRECT_DENIED: 'NET_REDIRECT_DENIED',
  NET_PRIVATE_ADDRESS: 'NET_PRIVATE_ADDRESS',
  NET_LIMIT_EXCEEDED: 'NET_LIMIT_EXCEEDED',
  // secretos
  SECRET_NOT_ALLOWED: 'SECRET_NOT_ALLOWED',
  SECRET_NOT_AVAILABLE: 'SECRET_NOT_AVAILABLE',
  SECRET_VALUE_NEVER_RETURNED: 'SECRET_VALUE_NEVER_RETURNED',
  // GUI
  PRECONDITION_WINDOW: 'PRECONDITION_WINDOW',
  OBSERVATION_STALE: 'OBSERVATION_STALE',
  ACTION_BUDGET_EXHAUSTED: 'ACTION_BUDGET_EXHAUSTED',
  // genérico
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INTERNAL: 'INTERNAL',
};

const deny = (code, message, opts) => new GhostError(code, message, opts);

module.exports = { GhostError, CODES, deny };
