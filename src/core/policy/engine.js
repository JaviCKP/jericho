'use strict';

const { GhostError, CODES } = require('../errors');
const { RISK, parseRisk, riskName, maxRisk } = require('../risk');
const { ANONYMOUS_SESSION } = require('../ids');

/**
 * PolicyEngine: único punto de decisión.
 *
 * Ninguna herramienta ejecuta una operación sensible sin pasar por aquí.
 * Se comprueba con `tests/contract/chokepoint.test.js`, que verifica de forma
 * estructural que ninguna implementación de herramienta importa child_process,
 * fetch o fs de escritura directamente.
 *
 * Evalúa: identidad, proyecto, raíz autorizada, herramienta, versión, nivel de
 * riesgo, permisos, aprobación, destino de red, tipo y cantidad de datos,
 * límites de recursos, precondiciones, estado de la sesión y política de secretos.
 */

class PolicyEngine {
  constructor({ policy, roots, approvals, journal, metrics, profiles }) {
    this.policy = policy;
    this.roots = roots;
    this.approvals = approvals;
    this.journal = journal;
    this.metrics = metrics;
    this.profiles = profiles; // { profileName: Set<toolName> }
    this.maxRisk = parseRisk(policy.max_risk);
    this.anonMaxRisk = parseRisk(policy.anonymous_max_risk);
    this.approvalAt = parseRisk(policy.approval.required_at_or_above);
    this.enabledTools = new Set();
    for (const p of policy.profiles) {
      const set = this.profiles[p];
      if (!set) continue;
      for (const t of set) this.enabledTools.add(t);
    }
  }

  get limits() {
    return this.policy.limits;
  }

  isToolEnabled(name) {
    return this.enabledTools.has(name);
  }

  enabledToolNames() {
    return [...this.enabledTools];
  }

  /**
   * Riesgo derivado de los efectos observables de la llamada.
   * Sólo puede ELEVAR el riesgo declarado, nunca rebajarlo.
   */
  deriveRisk(effects = {}) {
    let level = RISK.R0;
    if (effects.writesFiles) level = maxRisk(level, RISK.R1);
    if (effects.spawnsProcess) level = maxRisk(level, RISK.R1);
    if (effects.externalEffect) level = maxRisk(level, RISK.R2);
    if (effects.network) level = maxRisk(level, RISK.R2);
    if (effects.guiInput) level = maxRisk(level, RISK.R2);
    if (effects.destructive) level = maxRisk(level, RISK.R3);
    if (effects.touchesSecrets) level = maxRisk(level, RISK.R3);
    if (effects.gitRemote) level = maxRisk(level, RISK.R3);
    if (effects.systemChange) level = maxRisk(level, RISK.R3);
    if (effects.egressBytes > (this.policy.network.egress_free_bytes || 0)) level = maxRisk(level, RISK.R3);
    if (effects.generalPrivilege) level = maxRisk(level, RISK.R4);
    return level;
  }

  /** Busca una concesión permanente que cubra la operación. */
  findStandingGrant(tool, effectiveRisk, effects) {
    for (const grant of this.policy.approval.standing_grants || []) {
      if (!Array.isArray(grant.tools) || !grant.tools.includes(tool)) continue;
      let grantMax;
      try {
        grantMax = parseRisk(grant.max_risk);
      } catch (e) {
        continue;
      }
      if (effectiveRisk > grantMax) continue;
      if (grant.methods && effects.method && !grant.methods.includes(String(effects.method).toUpperCase())) continue;
      if (grant.root && effects.root && grant.root !== effects.root) continue;
      // Condición para el uso de secretos: la persona ya autorizó ESOS nombres
      // concretos en secrets.allowed. Pedir además una aprobación por llamada
      // sería fatiga de confirmaciones sin ganancia de seguridad.
      if (grant.requires_preauthorized_secrets === true && effects.secretsPreauthorized !== true) continue;
      return grant;
    }
    return null;
  }

  /**
   * Autoriza una llamada. Lanza GhostError si se deniega o falta aprobación.
   *
   * @returns {{effective_risk:string, approval:string, dry_run:boolean, grant:object|null}}
   */
  authorize(ctx) {
    const {
      tool,
      toolVersion,
      declaredRisk,
      args = {},
      session = {},
      effects = {},
      approvalId = null,
      dryRun = false,
      summary = '',
    } = ctx;

    if (!tool) throw new GhostError(CODES.INVALID_ARGUMENT, 'authorize requiere el nombre de la herramienta.');

    // 1. Perfil
    if (!this.isToolEnabled(tool)) {
      throw new GhostError(
        CODES.PROFILE_DISABLED,
        `La herramienta '${tool}' no está en ningún perfil activo (${this.policy.profiles.join(', ')}).`,
        {
          remediation:
            'Una persona debe añadir el perfil correspondiente en data/control/policy.json. El agente no puede activarlo.',
        }
      );
    }

    // 2. Circuit breaker
    if (this.metrics) this.metrics.assertClosed(tool);

    // 3. Riesgo efectivo. Un dry-run no produce efectos: se evalúa como lectura.
    const declared = parseRisk(declaredRisk == null ? 'R0' : declaredRisk);
    const derived = this.deriveRisk(effects);
    let effective = dryRun ? RISK.R0 : maxRisk(declared, derived);

    // 4. Techo global
    if (effective > this.maxRisk) {
      throw new GhostError(
        CODES.RISK_LEVEL_DISABLED,
        `Operación de nivel ${riskName(effective)} por encima del máximo permitido (${riskName(this.maxRisk)}).`,
        {
          details: { declared: riskName(declared), derived: riskName(derived) },
          remediation: 'Una persona debe subir max_risk en la política, o usa una operación de menor riesgo.',
        }
      );
    }

    // 5. Identidad: la conexión MCP no es identidad. Sin session_id explícito, se limita.
    const sessionId = session.session_id || ANONYMOUS_SESSION;
    if (sessionId === ANONYMOUS_SESSION && effective > this.anonMaxRisk) {
      throw new GhostError(
        CODES.POLICY_DENIED,
        `Sesión anónima limitada a ${riskName(this.anonMaxRisk)}; esta operación es ${riskName(effective)}.`,
        {
          recoverable: true,
          remediation:
            'Vuelve a llamar indicando un session_id explícito (p. ej. el que devuelve memory.resume). ' +
            'GhostPC no usa la conexión MCP como identidad.',
        }
      );
    }

    // 6. Proyecto y raíz: si la operación toca archivos, debe declarar la raíz.
    if (effects.root && !this.roots.byName(effects.root)) {
      throw new GhostError(CODES.ROOT_UNKNOWN, `Raíz autorizada desconocida: '${effects.root}'.`);
    }

    // 7. Aprobación
    let approval = 'not_required';
    let grant = null;
    if (effective >= this.approvalAt) {
      if (!session.user_id || !session.project_id) {
        throw new GhostError(CODES.POLICY_DENIED, 'Las operaciones que requieren aprobación necesitan sesión, usuario y proyecto autenticados.');
      }
      grant = this.findStandingGrant(tool, effective, effects);
      if (grant) {
        approval = 'standing_grant';
      } else if (approvalId) {
        this.approvals.consume(approvalId, tool, args, {
          session_id: session.session_id,
          user_id: session.user_id,
          project_id: session.project_id,
        }); // lanza si no es válida
        approval = `explicit:${approvalId}`;
      } else {
        const req = this.approvals.request({
          tool,
          args,
          risk: riskName(effective),
          reason: this._reasonFor(effects),
          summary: summary || `${tool} (${riskName(effective)})`,
          sessionId,
          projectId: session.project_id || null,
          userId: session.user_id || null,
          operation: tool,
          effects,
        });
        if (this.metrics) this.metrics.bump('approvals_requested');
        throw new GhostError(
          CODES.APPROVAL_REQUIRED,
          `Esta operación es ${riskName(effective)} y necesita aprobación explícita de una persona.`,
          {
            recoverable: true,
            remediation:
              `Pide a la persona que ejecute:  npm run approve -- ${req.approval_id}\n` +
              `Después repite esta llamada añadiendo approval_id="${req.approval_id}".`,
            details: {
              approval_id: req.approval_id,
              expires_at: req.expires_at,
              summary: req.summary,
              what_will_happen: this._reasonFor(effects),
            },
          }
        );
      }
    }

    const decision = {
      effective_risk: riskName(effective),
      declared_risk: riskName(declared),
      derived_risk: riskName(derived),
      approval,
      dry_run: !!dryRun,
      grant: grant ? grant.reason : null,
      tool_version: toolVersion || null,
      session_id: sessionId,
    };
    return decision;
  }

  _reasonFor(effects) {
    const parts = [];
    if (effects.writesFiles) parts.push('escribe archivos en el proyecto');
    if (effects.destructive) parts.push('BORRA o sobrescribe datos de forma difícil de revertir');
    if (effects.spawnsProcess) parts.push(`ejecuta el programa '${effects.program || '?'}'`);
    if (effects.network) parts.push(`contacta con '${effects.destination || effects.method || 'red'}'`);
    if (effects.egressBytes) parts.push(`envía ${effects.egressBytes} bytes leídos del equipo hacia fuera`);
    if (effects.guiInput) parts.push('envía entrada de teclado/ratón al escritorio');
    if (effects.touchesSecrets) parts.push('usa un secreto');
    if (effects.gitRemote) parts.push('opera contra un remoto Git');
    if (effects.systemChange) parts.push('cambia configuración del sistema');
    if (effects.generalPrivilege) parts.push('PRIVILEGIO GENERAL');
    return parts.length ? parts.join('; ') : 'efecto no clasificado';
  }

  /** Comprobación de límites numéricos. Devuelve el valor recortado o lanza. */
  assertLimit(actual, limitPath, what) {
    const limit = limitPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.policy.limits);
    if (typeof limit !== 'number') return actual;
    if (actual > limit) {
      throw new GhostError(CODES.LIMIT_EXCEEDED, `${what}: ${actual} supera el límite de política (${limit}).`, {
        details: { limit, actual, limitPath },
        remediation: 'Divide la operación en partes más pequeñas.',
      });
    }
    return actual;
  }

  describe() {
    return {
      profiles: this.policy.profiles,
      max_risk: this.policy.max_risk,
      anonymous_max_risk: this.policy.anonymous_max_risk,
      approval_required_at_or_above: this.policy.approval.required_at_or_above,
      standing_grants: (this.policy.approval.standing_grants || []).map((g) => ({
        tools: g.tools,
        max_risk: g.max_risk,
        reason: g.reason,
      })),
      roots: this.roots.list(),
      network_destinations: this.policy.network.destinations.map((d) => ({
        alias: d.alias,
        origin: d.origin,
        methods: d.methods,
      })),
      secrets_available: this.policy.secrets.allowed,
      limits: this.policy.limits,
      enabled_tools: this.enabledToolNames().sort(),
    };
  }
}

module.exports = { PolicyEngine };
