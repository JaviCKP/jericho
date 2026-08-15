'use strict';

const fs = require('fs');
const path = require('path');
const { GhostError, CODES } = require('../errors');
const { writeJsonAtomic, writeFileAtomic, readJsonSafe, sweepTemp, Lease } = require('../atomic');
const { newWorkItemId } = require('../ids');
const redact = require('../redact');
const schema = require('./schema');
const { renderWorkItemMarkdown } = require('./render');

/**
 * Almacén de memoria v2.
 *
 * Separación estricta:
 *   policy/        (1) reglas globales aprobadas + propuestas pendientes
 *   projects/<p>/project.json      (2) configuración del proyecto
 *   projects/<p>/items/<id>.json   (3) work items
 *   projects/<p>/decisions/        (4) decisiones
 *   projects/<p>/journal.jsonl     (5) diario de sesiones (sólo se añade)
 *   index.json                     (6) índice derivado, reconstruible
 *
 * Propiedades: escritura atómica, compare-and-swap por `revision`, historial
 * completo, leases para evitar que dos chats se pisen, validación de esquema y
 * recuperación tras caída.
 */

class MemoryStore {
  constructor({ dir, journal = null, policy = null }) {
    this.dir = dir;
    this.journal = journal;
    this.policy = policy;
    this.policyDir = path.join(dir, 'policy');
    this.proposalsDir = path.join(this.policyDir, 'proposals');
    this.projectsDir = path.join(dir, 'projects');
    this.locksDir = path.join(dir, 'locks');
    this.indexFile = path.join(dir, 'index.json');
    this.metaFile = path.join(dir, 'meta.json');
    for (const d of [this.policyDir, this.proposalsDir, this.projectsDir, this.locksDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
    if (!fs.existsSync(this.metaFile)) {
      writeJsonAtomic(this.metaFile, {
        schema_version: schema.SCHEMA_VERSION,
        created_at: new Date().toISOString(),
      });
    }
  }

  /* --------------------------- utilidades internas --------------------------- */

  static _safeId(value, label) {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value)) {
      throw new GhostError(CODES.INVALID_ARGUMENT, `${label} inválido: sólo [a-z0-9._-], máx. 128 caracteres.`);
    }
    if (value.includes('..')) throw new GhostError(CODES.INVALID_ARGUMENT, `${label} no puede contener '..'.`);
    return value;
  }

  _projectDir(projectId) {
    MemoryStore._safeId(projectId, 'project_id');
    return path.join(this.projectsDir, projectId);
  }

  _itemFile(projectId, itemId) {
    MemoryStore._safeId(itemId, 'id');
    return path.join(this._projectDir(projectId), 'items', `${itemId}.json`);
  }

  _historyDir(projectId, itemId) {
    return path.join(this._projectDir(projectId), 'history', MemoryStore._safeId(itemId, 'id'));
  }

  /* ------------------------------- proyectos -------------------------------- */

  listProjects() {
    if (!fs.existsSync(this.projectsDir)) return [];
    return fs
      .readdirSync(this.projectsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const cfg = readJsonSafe(path.join(this.projectsDir, e.name, 'project.json'), null);
        return {
          project_id: e.name,
          config: cfg.ok ? cfg.value : null,
          config_error: cfg.ok ? null : cfg.error,
        };
      });
  }

  ensureProject(projectId, config = {}) {
    const dir = this._projectDir(projectId);
    fs.mkdirSync(path.join(dir, 'items'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'history'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'decisions'), { recursive: true });
    const file = path.join(dir, 'project.json');
    if (!fs.existsSync(file)) {
      writeJsonAtomic(file, {
        schema_version: schema.SCHEMA_VERSION,
        project_id: projectId,
        created_at: new Date().toISOString(),
        root: config.root || null,
        repo_path: config.repo_path || null,
        default_branch: config.default_branch || null,
        notes: config.notes || '',
      });
    } else if (Object.keys(config).length) {
      const cur = readJsonSafe(file, {}).value || {};
      writeJsonAtomic(file, { ...cur, ...config, project_id: projectId, updated_at: new Date().toISOString() });
    }
    return readJsonSafe(file, {}).value;
  }

  getProject(projectId) {
    const res = readJsonSafe(path.join(this._projectDir(projectId), 'project.json'), null);
    if (!res.ok) {
      throw new GhostError(CODES.SCHEMA_INVALID, `project.json de '${projectId}' está corrupto: ${res.error}`);
    }
    return res.value;
  }

  /* ------------------------------ work items -------------------------------- */

  listItems(projectId, { status = null } = {}) {
    const dir = path.join(this._projectDir(projectId), 'items');
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const res = readJsonSafe(path.join(dir, f), null);
      if (!res.ok) {
        out.push({ id: f.replace(/\.json$/, ''), __corrupt: true, error: res.error });
        continue;
      }
      if (status && res.value.status !== status) continue;
      out.push(res.value);
    }
    return out;
  }

  get(projectId, itemId) {
    const file = this._itemFile(projectId, itemId);
    const res = readJsonSafe(file, null);
    if (res.missing || res.value === null) {
      throw new GhostError(CODES.NOT_FOUND, `No existe el work item '${itemId}' en el proyecto '${projectId}'.`, {
        recoverable: true,
      });
    }
    if (!res.ok) {
      throw new GhostError(CODES.SCHEMA_INVALID, `El work item '${itemId}' está corrupto: ${res.error}`, {
        remediation: 'Usa memory.restore para recuperar la última revisión válida del historial.',
      });
    }
    return res.value;
  }

  /**
   * Crea un work item nuevo.
   * @returns {{item:object, created:boolean}}
   */
  create(projectId, fields, { sessionId = null, author = null } = {}) {
    this.ensureProject(projectId);
    const id = fields.id ? MemoryStore._safeId(fields.id, 'id') : newWorkItemId();
    const file = this._itemFile(projectId, id);
    if (fs.existsSync(file)) {
      throw new GhostError(CODES.REVISION_CONFLICT, `El work item '${id}' ya existe. Usa memory.checkpoint con expected_revision.`, {
        recoverable: true,
      });
    }
    const item = schema.emptyWorkItem({
      ...fields,
      id,
      project_id: projectId,
      revision: 1,
      session_id: sessionId,
      author: author || sessionId,
    });
    schema.validateWorkItem(item);
    this._persist(projectId, item, { reason: 'create' });
    return { item, created: true };
  }

  /**
   * Actualiza con compare-and-swap.
   *
   * @param {number} expectedRevision revisión que el llamante cree vigente
   * @throws REVISION_CONFLICT si otro chat escribió entre medias
   */
  update(projectId, itemId, patch, { expectedRevision, sessionId = null, traceExists = null } = {}) {
    const lockDir = path.join(this.locksDir, `${projectId}__${itemId}`);
    const lease = new Lease(lockDir, { ttlMs: 15_000, owner: sessionId || 'unknown' });
    const acquired = lease.tryAcquire();
    if (!acquired.acquired) {
      throw new GhostError(
        CODES.LEASE_HELD,
        `Otra sesión (${acquired.heldBy}) está escribiendo en '${itemId}'. Reintenta en unos segundos.`,
        { recoverable: true, details: { held_by: acquired.heldBy, expires_at: acquired.expiresAt } }
      );
    }
    try {
      const current = this.get(projectId, itemId);

      if (expectedRevision === undefined || expectedRevision === null) {
        throw new GhostError(
          CODES.INVALID_ARGUMENT,
          'expected_revision es obligatorio: evita que dos chats se pisen sin darse cuenta.',
          { details: { current_revision: current.revision } }
        );
      }
      if (current.revision !== expectedRevision) {
        throw new GhostError(
          CODES.REVISION_CONFLICT,
          `Conflicto de revisión: esperabas ${expectedRevision} pero la vigente es ${current.revision}. ` +
            'Otro chat o sesión modificó este work item.',
          {
            recoverable: true,
            details: {
              expected: expectedRevision,
              actual: current.revision,
              updated_at: current.updated_at,
              updated_by: current.session_id,
            },
            remediation: 'Vuelve a leer el work item (memory.resume), integra los cambios y reintenta.',
          }
        );
      }

      const next = {
        ...current,
        ...patch,
        id: current.id,
        project_id: current.project_id,
        schema_version: schema.SCHEMA_VERSION,
        revision: current.revision + 1,
        created_at: current.created_at,
        updated_at: new Date().toISOString(),
        session_id: sessionId || current.session_id,
      };

      // Transición a COMPLETED: sólo con evidencia válida.
      if (next.status === 'COMPLETED' && current.status !== 'COMPLETED') {
        if (!this.policy || this.policy.memory.require_evidence_for_completion !== false) {
          const check = schema.checkCompletionEvidence(next, traceExists);
          if (!check.ok) {
            throw new GhostError(
              CODES.EVIDENCE_MISSING,
              'No se puede marcar COMPLETED: faltan evidencias para criterios de aceptación obligatorios.',
              {
                recoverable: true,
                details: { missing: check.missing, unverifiable: check.unverifiable },
                remediation:
                  'Ejecuta la verificación real (verify.run / terminal.exec) y añade a `evidence` una entrada ' +
                  'con criterion_id, kind, result="pass" y el trace_id que devolvió esa operación.',
              }
            );
          }
        }
        next.completed_at = new Date().toISOString();
      }

      schema.validateWorkItem(next);
      this._persist(projectId, next, { reason: 'update', previous: current });
      return next;
    } finally {
      lease.release();
    }
  }

  _persist(projectId, item, { reason, previous = null }) {
    const file = this._itemFile(projectId, item.id);
    fs.mkdirSync(path.dirname(file), { recursive: true });

    // 1. Historial ANTES de sobrescribir: nunca se pierde una revisión.
    if (previous) {
      const hdir = this._historyDir(projectId, item.id);
      fs.mkdirSync(hdir, { recursive: true });
      writeJsonAtomic(path.join(hdir, `rev-${String(previous.revision).padStart(6, '0')}.json`), previous);
    }

    // 2. Escritura atómica del estado vigente.
    writeJsonAtomic(file, item);

    // 3. Vista Markdown derivada (para personas). NO es fuente de verdad.
    try {
      writeFileAtomic(file.replace(/\.json$/, '.md'), renderWorkItemMarkdown(item));
    } catch (e) {
      /* la vista es opcional; su fallo no invalida el dato */
    }

    // 4. Diario del proyecto (sólo se añade).
    this.appendProjectJournal(projectId, {
      kind: `work_item.${reason}`,
      id: item.id,
      revision: item.revision,
      status: item.status,
      session_id: item.session_id,
    });

    // 5. Índice derivado.
    this.rebuildIndex();

    if (this.journal) {
      this.journal.append({
        kind: `memory.${reason}`,
        project_id: projectId,
        work_item: item.id,
        revision: item.revision,
        status: item.status,
        session_id: item.session_id,
      });
    }
  }

  /* ------------------------------- historial -------------------------------- */

  history(projectId, itemId) {
    const hdir = this._historyDir(projectId, itemId);
    if (!fs.existsSync(hdir)) return [];
    return fs
      .readdirSync(hdir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => {
        const res = readJsonSafe(path.join(hdir, f), null);
        return res.ok && res.value
          ? {
              revision: res.value.revision,
              status: res.value.status,
              updated_at: res.value.updated_at,
              session_id: res.value.session_id,
              file: f,
            }
          : { file: f, corrupt: true };
      });
  }

  /** Restaura una revisión anterior como nueva revisión (no borra historia). */
  restore(projectId, itemId, revision, { sessionId = null } = {}) {
    const hdir = this._historyDir(projectId, itemId);
    const file = path.join(hdir, `rev-${String(revision).padStart(6, '0')}.json`);
    const res = readJsonSafe(file, null);
    if (!res.ok || !res.value) {
      throw new GhostError(CODES.NOT_FOUND, `No existe la revisión ${revision} de '${itemId}'.`);
    }
    let current = null;
    try {
      current = this.get(projectId, itemId);
    } catch (e) {
      /* el actual puede estar corrupto: por eso restauramos */
    }
    const restored = {
      ...res.value,
      revision: (current ? current.revision : res.value.revision) + 1,
      updated_at: new Date().toISOString(),
      session_id: sessionId,
      restored_from_revision: revision,
    };
    schema.validateWorkItem(restored);
    this._persist(projectId, restored, { reason: 'restore', previous: current });
    return restored;
  }

  /* --------------------------- diario de sesiones --------------------------- */

  appendProjectJournal(projectId, entry) {
    const dir = this._projectDir(projectId);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'journal.jsonl');
    const line = JSON.stringify(redact.redactValue({ ts: new Date().toISOString(), ...entry })) + '\n';
    fs.appendFileSync(file, line, 'utf-8');
  }

  readProjectJournal(projectId, { limit = 100 } = {}) {
    const file = path.join(this._projectDir(projectId), 'journal.jsonl');
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        return { __corrupt: true };
      }
    });
  }

  /**
   * Compactación: genera un resumen del diario y lo guarda aparte.
   * NUNCA borra el diario original: sólo escribe `journal-compact.json`.
   */
  compact(projectId) {
    const entries = this.readProjectJournal(projectId, { limit: 100000 });
    const byKind = {};
    for (const e of entries) {
      byKind[e.kind || 'unknown'] = (byKind[e.kind || 'unknown'] || 0) + 1;
    }
    const summary = {
      compacted_at: new Date().toISOString(),
      total_entries: entries.length,
      first_entry: entries[0] ? entries[0].ts : null,
      last_entry: entries.length ? entries[entries.length - 1].ts : null,
      counts_by_kind: byKind,
      note: 'Resumen derivado. El diario original journal.jsonl se conserva intacto.',
    };
    writeJsonAtomic(path.join(this._projectDir(projectId), 'journal-compact.json'), summary);
    return summary;
  }

  /* --------------------------- reglas globales ------------------------------ */

  getGlobalRules() {
    const file = path.join(this.policyDir, 'rules.json');
    const res = readJsonSafe(file, null);
    if (res.missing || !res.value) {
      return { schema_version: schema.SCHEMA_VERSION, rules: [], updated_at: null };
    }
    if (!res.ok) throw new GhostError(CODES.SCHEMA_INVALID, `rules.json corrupto: ${res.error}`);
    return res.value;
  }

  /**
   * El agente NO puede cambiar las reglas globales. Sólo puede proponer.
   * La persona aprueba con `npm run rules -- accept <proposal_id>`.
   */
  proposeGlobalRule({ text, rationale, sessionId, traceId }) {
    if (typeof text !== 'string' || text.trim().length < 5) {
      throw new GhostError(CODES.INVALID_ARGUMENT, 'El texto de la regla es obligatorio.');
    }
    const id = `prop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const proposal = {
      proposal_id: id,
      text: text.trim(),
      rationale: rationale || '',
      proposed_by_session: sessionId || null,
      trace_id: traceId || null,
      created_at: new Date().toISOString(),
      status: 'PENDING',
    };
    writeJsonAtomic(path.join(this.proposalsDir, `${id}.json`), proposal);
    if (this.journal) {
      this.journal.append({ kind: 'memory.rule_proposed', proposal_id: id, session_id: sessionId });
    }
    return proposal;
  }

  listRuleProposals() {
    return fs
      .readdirSync(this.proposalsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJsonSafe(path.join(this.proposalsDir, f), null).value)
      .filter(Boolean)
      .filter((p) => p.status === 'PENDING');
  }

  /** Sólo lo invoca el script de operador, nunca una herramienta MCP. */
  decideRuleProposal(proposalId, accept, by) {
    const file = path.join(this.proposalsDir, `${MemoryStore._safeId(proposalId, 'proposal_id')}.json`);
    const res = readJsonSafe(file, null);
    if (!res.ok || !res.value) throw new GhostError(CODES.NOT_FOUND, `Propuesta '${proposalId}' desconocida.`);
    const proposal = res.value;
    proposal.status = accept ? 'ACCEPTED' : 'REJECTED';
    proposal.decided_at = new Date().toISOString();
    proposal.decided_by = by || 'operator';
    writeJsonAtomic(file, proposal);

    if (accept) {
      const rules = this.getGlobalRules();
      rules.rules.push({
        id: proposal.proposal_id,
        text: proposal.text,
        rationale: proposal.rationale,
        accepted_at: proposal.decided_at,
        accepted_by: proposal.decided_by,
      });
      rules.updated_at = proposal.decided_at;
      rules.schema_version = schema.SCHEMA_VERSION;
      writeJsonAtomic(path.join(this.policyDir, 'rules.json'), rules);
    }
    if (this.journal) {
      this.journal.append({ kind: 'memory.rule_decided', proposal_id: proposalId, decision: proposal.status, by });
    }
    return proposal;
  }

  /* ------------------------------- decisiones -------------------------------- */

  recordDecision(projectId, { title, context, decision, consequences, sessionId, traceId }) {
    this.ensureProject(projectId);
    const id = `dec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const record = {
      schema_version: schema.SCHEMA_VERSION,
      id,
      project_id: projectId,
      title,
      context: context || '',
      decision,
      consequences: consequences || '',
      created_at: new Date().toISOString(),
      session_id: sessionId || null,
      trace_id: traceId || null,
    };
    writeJsonAtomic(path.join(this._projectDir(projectId), 'decisions', `${id}.json`), record);
    this.appendProjectJournal(projectId, { kind: 'decision.recorded', id, title });
    return record;
  }

  listDecisions(projectId, { limit = 50 } = {}) {
    const dir = path.join(this._projectDir(projectId), 'decisions');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .slice(-limit)
      .map((f) => readJsonSafe(path.join(dir, f), null).value)
      .filter(Boolean);
  }

  /* --------------------------- índice derivado ------------------------------ */

  /** El índice SIEMPRE se puede reconstruir desde los archivos fuente. */
  rebuildIndex() {
    const index = {
      schema_version: schema.SCHEMA_VERSION,
      rebuilt_at: new Date().toISOString(),
      projects: [],
    };
    for (const p of this.listProjects()) {
      const items = this.listItems(p.project_id).map((i) => ({
        id: i.id,
        title: i.title,
        status: i.status,
        revision: i.revision,
        updated_at: i.updated_at,
        next_action: i.next_action,
        branch: i.branch,
        corrupt: !!i.__corrupt,
      }));
      index.projects.push({
        project_id: p.project_id,
        item_count: items.length,
        open_items: items.filter((i) => !['COMPLETED', 'ABANDONED'].includes(i.status)).length,
        items,
      });
    }
    writeJsonAtomic(this.indexFile, index);
    return index;
  }

  readIndex({ rebuildIfMissing = true } = {}) {
    const res = readJsonSafe(this.indexFile, null);
    if ((!res.ok || !res.value) && rebuildIfMissing) return this.rebuildIndex();
    return res.value;
  }

  /* ---------------------------- recuperación -------------------------------- */

  /**
   * Recuperación tras caída: limpia temporales, detecta archivos corruptos y
   * reconstruye el índice. No borra nada: informa.
   */
  recover() {
    const tmp = sweepTemp(this.dir);
    const corrupt = [];
    for (const p of this.listProjects()) {
      for (const item of this.listItems(p.project_id)) {
        if (item.__corrupt) {
          const revs = this.history(p.project_id, item.id);
          corrupt.push({
            project_id: p.project_id,
            id: item.id,
            error: item.error,
            recoverable_revisions: revs.length,
            hint: revs.length
              ? `usa memory.restore(project_id, id, revision=${revs[revs.length - 1].revision})`
              : 'sin historial disponible',
          });
        }
      }
    }
    // También limpiamos leases caducados.
    let staleLocks = 0;
    if (fs.existsSync(this.locksDir)) {
      for (const d of fs.readdirSync(this.locksDir)) {
        const meta = readJsonSafe(path.join(this.locksDir, d, 'owner.json'), null).value;
        if (!meta || !meta.expires_at || Date.parse(meta.expires_at) < Date.now()) {
          try {
            fs.rmSync(path.join(this.locksDir, d), { recursive: true, force: true });
            staleLocks++;
          } catch (e) { /* ignorado */ }
        }
      }
    }
    const index = this.rebuildIndex();
    return {
      temp_removed: tmp,
      corrupt_items: corrupt,
      stale_locks_cleared: staleLocks,
      projects: index.projects.length,
    };
  }
}

module.exports = { MemoryStore };
