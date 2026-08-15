'use strict';

const fs = require('fs');
const path = require('path');
const { newApprovalId, fingerprint } = require('../ids');
const { JerichoError, CODES } = require('../errors');
const redact = require('../redact');
const crypto = require('crypto');

/**
 * Aprobaciones fuera de banda.
 *
 * El modelo NUNCA puede aprobar. Cuando una operación necesita aprobación:
 *  1. El servidor crea una solicitud pendiente en disco y devuelve APPROVAL_REQUIRED
 *     con el `approval_id` y un resumen legible de lo que se va a hacer.
 *  2. La persona ejecuta `npm run approve -- <approval_id>` (o `deny`).
 *  3. El modelo repite la llamada con `approval_id`.
 *
 * La aprobación está vinculada a la HUELLA exacta de la operación: aprobar
 * "borrar A" no autoriza "borrar B". Es de un solo uso y caduca.
 *
 * Las concesiones permanentes (`standing grants`) las define la persona en la
 * política; sirven para no pedir confirmación en operaciones rutinarias.
 */

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 min

class ApprovalStore {
  constructor(dir, { ttlMs = DEFAULT_TTL_MS, journal = null, operatorSecret = null } = {}) {
    this.dir = dir;
    this.pendingDir = path.join(dir, 'pending');
    this.decidedDir = path.join(dir, 'decided');
    fs.mkdirSync(this.pendingDir, { recursive: true });
    fs.mkdirSync(this.decidedDir, { recursive: true });
    this.ttlMs = ttlMs;
    this.journal = journal;
    this.operatorSecret = operatorSecret || process.env.JERICHO_OPERATOR_SECRET || null;
  }

  _file(dir, id) {
    if (!/^apr_[A-Za-z0-9_]+$/.test(id)) {
      throw new JerichoError(CODES.APPROVAL_INVALID, 'Identificador de aprobación con formato inválido.');
    }
    return path.join(dir, `${id}.json`);
  }

  /** Crea una solicitud pendiente. Devuelve el id y el resumen. */
  request({ tool, args, risk, reason, summary, sessionId, projectId, userId, operation, files, beforeHash, afterHash, effects }) {
    const id = newApprovalId();
    const fp = fingerprint(tool, args);
    const record = {
      approval_id: id,
      fingerprint: fp,
      tool,
      risk,
      reason,
      summary,
      session_id: sessionId || null,
      project_id: projectId || null,
      user_id: userId || null,
      operation: operation || tool,
      files: files || [],
      before_hash: beforeHash || null,
      after_hash: afterHash || null,
      nonce: crypto.randomBytes(16).toString('hex'),
      effects: redact.redactValue(effects || {}),
      args_redacted: redact.redactValue(args),
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + this.ttlMs).toISOString(),
      status: 'PENDING',
    };
    fs.writeFileSync(this._file(this.pendingDir, id), JSON.stringify(record, null, 2), 'utf-8');
    if (this.journal) {
      this.journal.append({ kind: 'approval.requested', approval_id: id, tool, risk, reason, summary });
    }
    return record;
  }

  listPending() {
    const now = Date.now();
    return fs
      .readdirSync(this.pendingDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.pendingDir, f), 'utf-8'));
        } catch (e) {
          return null;
        }
      })
      .filter((r) => r && Date.parse(r.expires_at) > now);
  }

  /** Decisión humana. `by` identifica quién decidió (usuario del SO). */
  decide(id, approved, by, operatorContext = null) {
    if (!operatorContext || operatorContext.channel !== 'operator' || operatorContext.authenticated !== true || !Array.isArray(operatorContext.acl) || !operatorContext.acl.includes('approval:decide') || !operatorContext.nonce || !this.operatorSecret) {
      throw new JerichoError(CODES.POLICY_DENIED, 'La aprobación requiere el canal de operador autenticado y ACL válida.');
    }
    const file = this._file(this.pendingDir, id);
    if (!fs.existsSync(file)) {
      throw new JerichoError(CODES.APPROVAL_INVALID, `No hay ninguna solicitud pendiente con id '${id}'.`);
    }
    const record = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (operatorContext.nonce !== record.nonce) {
      throw new JerichoError(CODES.POLICY_DENIED, 'Nonce de operador no coincide con la solicitud.');
    }
    const signed = crypto.createHmac('sha256', this.operatorSecret).update(`${id}:${record.nonce}:${approved ? 'approve' : 'deny'}`).digest('hex');
    if (operatorContext.signature !== signed) throw new JerichoError(CODES.POLICY_DENIED, 'Autenticación de operador inválida.');
    record.status = approved ? 'APPROVED' : 'DENIED';
    record.decided_at = new Date().toISOString();
    record.decided_by = by || 'unknown';
    const decidedFile = this._file(this.decidedDir, id);
    try { fs.renameSync(file, decidedFile); } catch (e) {
      throw new JerichoError(CODES.APPROVAL_INVALID, 'La aprobación ya fue consumida o no está disponible.');
    }
    fs.writeFileSync(decidedFile, JSON.stringify(record, null, 2), 'utf-8');
    if (this.journal) {
      this.journal.append({
        kind: 'approval.decided',
        approval_id: id,
        tool: record.tool,
        decision: record.status,
        decided_by: record.decided_by,
      });
    }
    return record;
  }

  /**
   * Consume una aprobación para una operación concreta.
   * Falla si: no existe, no está aprobada, caducó, ya se usó, o la huella no coincide.
   */
  consume(id, tool, args, context = {}) {
    const file = this._file(this.decidedDir, id);
    if (!fs.existsSync(file)) {
      // ¿Sigue pendiente?
      if (fs.existsSync(this._file(this.pendingDir, id))) {
        throw new JerichoError(CODES.APPROVAL_REQUIRED, `La aprobación '${id}' sigue pendiente de decisión humana.`, {
          recoverable: true,
          remediation: `Pide a la persona que ejecute: npm run approve -- ${id}`,
        });
      }
      throw new JerichoError(CODES.APPROVAL_INVALID, `Aprobación '${id}' desconocida.`);
    }
    const record = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (record.status !== 'APPROVED') {
      throw new JerichoError(CODES.APPROVAL_INVALID, `La aprobación '${id}' fue denegada por la persona.`);
    }
    for (const key of ['session_id', 'user_id', 'project_id']) {
      if ((record[key] || null) !== (context[key] || null)) throw new JerichoError(CODES.APPROVAL_INVALID, 'La aprobación no pertenece a esta sesión, usuario o proyecto.');
    }
    if (record.consumed_at) {
      throw new JerichoError(CODES.APPROVAL_INVALID, `La aprobación '${id}' ya se usó el ${record.consumed_at}. Las aprobaciones son de un solo uso.`);
    }
    if (Date.parse(record.expires_at) < Date.now()) {
      throw new JerichoError(CODES.APPROVAL_INVALID, `La aprobación '${id}' caducó el ${record.expires_at}.`, {
        recoverable: true,
        remediation: 'Vuelve a solicitar la operación para generar una nueva aprobación.',
      });
    }
    const fp = fingerprint(tool, args);
    if (fp !== record.fingerprint) {
      throw new JerichoError(
        CODES.APPROVAL_INVALID,
        'La aprobación no corresponde a esta operación exacta (la huella de los argumentos no coincide).',
        { details: { approved_tool: record.tool, attempted_tool: tool } }
      );
    }
    record.consumed_at = new Date().toISOString();
    const consumed = `${file}.consumed`;
    try { fs.renameSync(file, consumed); } catch (e) { throw new JerichoError(CODES.APPROVAL_INVALID, 'La aprobación ya fue consumida de forma concurrente.'); }
    fs.writeFileSync(consumed, JSON.stringify(record, null, 2), 'utf-8');
    if (this.journal) {
      this.journal.append({ kind: 'approval.consumed', approval_id: id, tool });
    }
    return record;
  }

  /** Limpieza de solicitudes caducadas. */
  gc() {
    const now = Date.now();
    let removed = 0;
    for (const f of fs.readdirSync(this.pendingDir)) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(this.pendingDir, f);
      try {
        const r = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (Date.parse(r.expires_at) < now) {
          fs.unlinkSync(p);
          removed++;
        }
      } catch (e) {
        fs.unlinkSync(p);
        removed++;
      }
    }
    return removed;
  }
}

module.exports = { ApprovalStore, DEFAULT_TTL_MS };
