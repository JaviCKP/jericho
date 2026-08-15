'use strict';

const crypto = require('crypto');
const { GhostError, CODES } = require('../errors');

/** Small, fail-closed authority boundary. MCP arguments are never identity. */
class SessionAuthority {
  constructor({ secret = null, policyRevision = null } = {}) {
    this.secret = secret || null;
    this.policyRevision = policyRevision || 'unknown';
  }

  issue({ session_id, user_id, project_id, permissions = [], profile = null, nonce = null, expires_at = null }) {
    if (!this.secret) throw new Error('session authority secret is not configured');
    if (!session_id || !user_id || !project_id) throw new Error('session context incomplete');
    const payload = { session_id, user_id, project_id, permissions, profile, policy_revision: this.policyRevision, nonce: nonce || crypto.randomBytes(16).toString('hex'), expires_at: expires_at || new Date(Date.now() + 15 * 60_000).toISOString() };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  authenticate(token) {
    if (!this.secret) throw new GhostError(CODES.POLICY_DENIED, 'Autoridad de sesión no configurada.');
    if (typeof token !== 'string') throw new GhostError(CODES.POLICY_DENIED, 'Falta contexto de sesión autenticado.');
    const [body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', this.secret).update(body || '').digest('base64url');
    if (!body || !sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      throw new GhostError(CODES.POLICY_DENIED, 'Contexto de sesión no autenticado.');
    }
    let ctx;
    try { ctx = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { throw new GhostError(CODES.POLICY_DENIED, 'Contexto de sesión inválido.'); }
    for (const key of ['session_id', 'user_id', 'project_id', 'policy_revision']) if (!ctx[key]) throw new GhostError(CODES.POLICY_DENIED, 'Contexto de sesión incompleto.');
    if (ctx.policy_revision !== this.policyRevision) throw new GhostError(CODES.POLICY_DENIED, 'Revisión de política obsoleta.');
    if (!ctx.expires_at || Date.parse(ctx.expires_at) <= Date.now()) throw new GhostError(CODES.POLICY_DENIED, 'Contexto de sesión caducado.');
    return Object.freeze(ctx);
  }
}

module.exports = { SessionAuthority };
