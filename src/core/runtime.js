'use strict';

const path = require('path');
const redact = require('./redact');
const { Journal } = require('./audit/journal');
const { Metrics } = require('./audit/metrics');
const { ApprovalStore } = require('./policy/approvals');
const { PolicyEngine } = require('./policy/engine');
const { loadPolicy } = require('./policy/loader');
const { Roots, defaultRootDefinitions } = require('./workspace/paths');
const { SecretBroker } = require('./secrets/broker');
const { ProcessRegistry } = require('./exec/registry');
const { ExecRunner } = require('./exec/runner');
const { NetworkGuard } = require('./net/guard');
const { MemoryStore } = require('./memory/store');
const { ObservationStore } = require('./desktop/observe');
const { sweepTemp } = require('./atomic');
const { SessionAuthority } = require('./session/authority');

/**
 * Construye el runtime completo de GhostPC.
 *
 * Orden importante:
 *  1. Redacción PRIMERO: cualquier cosa registrada después ya sale tachada.
 *  2. Diario: para que los fallos de arranque queden auditados.
 *  3. Política: falla cerrado si es inválida.
 *  4. Resto de subsistemas.
 */
function createRuntime(options = {}) {
  const env = options.env || process.env;
  const paths = {
    controlDir: options.controlDir,
    policyFile: options.policyFile,
    journalDir: options.journalDir,
    approvalsDir: options.approvalsDir,
    processStateFile: options.processStateFile,
    memoryDir: options.memoryDir,
  };

  // 1. Redacción con los secretos reales del host.
  const knownSecrets = redact.init(env, options.extraSecretValues || []);

  // 2. Diario inmutable.
  const journal = new Journal(paths.journalDir);

  // 3. Política (falla cerrado).
  const { policy, source, warnings } = loadPolicy({ policyFile: paths.policyFile, env });

  const metrics = new Metrics({
    failureThreshold: policy.audit.breaker_failure_threshold,
    cooldownMs: policy.audit.breaker_cooldown_ms,
  });

  const approvals = new ApprovalStore(paths.approvalsDir, {
    ttlMs: (policy.approval.ttl_minutes || 15) * 60 * 1000,
    journal,
    operatorSecret: env.GHOSTPC_OPERATOR_SECRET,
  });

  // 4. Raíces autorizadas. El directorio de control queda excluido siempre.
  const roots = new Roots(options.rootDefinitions || defaultRootDefinitions(env), [
    paths.controlDir,
    paths.memoryDir,
    path.dirname(paths.policyFile),
  ]);

  const secrets = new SecretBroker({
    allowed: policy.secrets.allowed || [],
    env,
    journal,
    metrics,
  });

  const registry = new ProcessRegistry(paths.processStateFile, { journal });
  const runner = new ExecRunner({ policy, registry, secrets, journal, metrics });
  const netGuard = new NetworkGuard({ policy, journal, metrics });
  const memory = new MemoryStore({ dir: paths.memoryDir, journal, policy });
  const observations = new ObservationStore({
    maxAgeMs: policy.limits.desktop.observation_max_age_ms,
    maxActionsWithoutObservation: policy.limits.desktop.max_actions_without_observation,
  });

  const engine = new PolicyEngine({
    policy,
    roots,
    approvals,
    journal,
    metrics,
    profiles: options.profiles || {},
  });
  const sessionAuthority = new SessionAuthority({
    secret: env.GHOSTPC_SESSION_AUTH_SECRET,
    policyRevision: require('crypto').createHash('sha256').update(JSON.stringify(policy)).digest('hex'),
  });

  const runtime = {
    env,
    paths,
    policy,
    policySource: source,
    policyWarnings: warnings,
    journal,
    metrics,
    approvals,
    roots,
    secrets,
    registry,
    runner,
    net: netGuard,
    memory,
    observations,
    engine,
    sessionAuthority,
    knownSecrets,
    startedAt: new Date().toISOString(),
  };

  return runtime;
}

/**
 * Recuperación al arrancar: temporales huérfanos, procesos huérfanos,
 * aprobaciones caducadas y verificación de la cadena del diario.
 */
async function recover(runtime) {
  const tmpRemoved = sweepTemp(runtime.paths.memoryDir) + sweepTemp(runtime.paths.controlDir);
  const orphans = await runtime.registry.recoverOrphans({ kill: true });
  const approvalsGc = runtime.approvals.gc();
  const chain = runtime.journal.verify();
  const memoryRecovery = runtime.memory.recover();

  runtime.journal.append({
    kind: 'server.started',
    policy_source: runtime.policySource,
    profiles: runtime.policy.profiles,
    max_risk: runtime.policy.max_risk,
    roots: runtime.roots.list().map((r) => r.name),
    recovery: {
      temp_files_removed: tmpRemoved,
      orphan_processes: orphans.recovered,
      orphan_processes_killed: orphans.killed,
      orphan_unverifiable: orphans.unverifiable,
      approvals_expired: approvalsGc,
      journal_chain_valid: chain.valid,
      memory: memoryRecovery,
    },
  });

  return {
    temp_files_removed: tmpRemoved,
    orphans,
    approvals_expired: approvalsGc,
    journal_chain: chain,
    memory: memoryRecovery,
  };
}

module.exports = { createRuntime, recover };
