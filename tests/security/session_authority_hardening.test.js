'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const h = require('../harness');
const { SessionAuthority } = require('../../src/core/session/authority');
const { ApprovalStore } = require('../../src/core/policy/approvals');
const { readResource, listResources } = require('../../src/server/resources');
const { IMPLEMENTATIONS } = require('../../src/tools');
const { sha256Text } = require('../../src/core/atomic');
const { CODES } = require('../../src/core/errors');

async function run() {
  await h.test('session authority rejects forged model identity', () => {
    const a = new SessionAuthority({ secret: 'test-secret', policyRevision: 'r1' });
    const token = a.issue({ session_id: 'sA', user_id: 'uA', project_id: 'pA', permissions: ['read'] });
    assert.deepStrictEqual(a.authenticate(token).project_id, 'pA');
    assert.deepStrictEqual(a.authenticate(token).permissions, ['read']);
    assert.throws(() => a.authenticate(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')), /Contexto|sesión/);
    const old = new SessionAuthority({ secret: 'test-secret', policyRevision: 'r2' });
    assert.throws(() => old.authenticate(token), /obsoleta|Contexto/);
    const expired = a.issue({ session_id: 'sA', user_id: 'uA', project_id: 'pA', expires_at: new Date(Date.now() - 1).toISOString() });
    assert.throws(() => a.authenticate(expired), /caducado/);
    assert.throws(() => new SessionAuthority({ policyRevision: 'r1' }).authenticate(token), /configurada/);
  });
  await h.test('approval requires authenticated operator and is one-shot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jericho-approval-'));
    const store = new ApprovalStore(dir, { ttlMs: 60_000, operatorSecret: 'test-op' });
    const req = store.request({ tool: 'x', args: { n: 1 }, risk: 'R3', reason: 'x', summary: 'x', sessionId: 'sA', userId: 'uA', projectId: 'pA' });
    assert.throws(() => store.decide(req.approval_id, true, 'model'), /operador autenticado/);
    assert.throws(() => store.decide(req.approval_id, true, 'operator', { channel: 'operator', authenticated: true, acl: ['approval:decide'], nonce: 'n' }), /Nonce/);
    const pending = store.listPending()[0];
    const signature = require('crypto').createHmac('sha256', 'test-op').update(`${req.approval_id}:${pending.nonce}:approve`).digest('hex');
    store.decide(req.approval_id, true, 'operator', { channel: 'operator', authenticated: true, acl: ['approval:decide'], nonce: pending.nonce, signature });
    store.consume(req.approval_id, 'x', { n: 1 }, { session_id: 'sA', user_id: 'uA', project_id: 'pA' });
    assert.throws(() => store.consume(req.approval_id, 'x', { n: 1 }, { session_id: 'sA', user_id: 'uA', project_id: 'pA' }));
    const expired = store.request({ tool: 'x', args: { n: 2 }, risk: 'R3', reason: 'x', summary: 'x', sessionId: 'sA', userId: 'uA', projectId: 'pA' });
    const expPending = store.listPending().find((a) => a.approval_id === expired.approval_id);
    const expSig = require('crypto').createHmac('sha256', 'test-op').update(`${expired.approval_id}:${expPending.nonce}:approve`).digest('hex');
    store.decide(expired.approval_id, true, 'operator', { channel: 'operator', authenticated: true, acl: ['approval:decide'], nonce: expPending.nonce, signature: expSig });
    assert.throws(() => store.consume(expired.approval_id, 'x', { n: 2 }, { session_id: 'sB', user_id: 'uB', project_id: 'pB' }), /sesión/);
  });
  await h.test('resources require authenticated context and isolate projects', () => {
    const runtime = { memory: { readIndex: () => ({ projects: [{ project_id: 'pA', items: [] }, { project_id: 'pB', items: [] }] }), get: () => ({}) }, engine: { describe: () => ({}) }, approvals: { listPending: () => [{ session_id: 'sA', user_id: 'uA', project_id: 'pA' }, { session_id: 'sB', user_id: 'uB', project_id: 'pB' }] }, journal: { verify: () => ({}), tail: () => [{ session_id: 'sA', project_id: 'pA', ok: 1 }, { session_id: 'sB', project_id: 'pB', secret: 'B' }] }, metrics: { snapshot: () => ({ global: 1 }) } };
    assert.throws(() => listResources(runtime, null), /autenticado/);
    const out = readResource(runtime, 'jericho://memory/index', { session_id: 'sA', user_id: 'uA', project_id: 'pA' });
    assert(!out.contents[0].text.includes('pB'));
    assert.throws(() => readResource(runtime, 'jericho://memory/pB/x', { session_id: 'sA', user_id: 'uA', project_id: 'pA' }), /otro proyecto/);
    const activity = readResource(runtime, 'jericho://activity', { session_id: 'sA', user_id: 'uA', project_id: 'pA' });
    assert(activity.contents[0].text.includes('"ok": 1'));
    assert(!activity.contents[0].text.includes('"secret"'));
  });
  await h.test('rollback enforces owner and compare-and-swap conflict', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jericho-rb-')), 'a.txt');
    fs.writeFileSync(file, 'new');
    const entry = { state: [{ absolute: file, existed: true, before: 'old', after_hash: sha256Text('new') }], session_id: 'sA', user_id: 'uA', project_id: 'pA', expires_at: Date.now() + 1000 };
    const ctx = { dispatcher: { rollbacks: new Map([['rb_x', entry]]) }, session: { session_id: 'sB', user_id: 'uB', project_id: 'pB' }, runtime: { metrics: { bump() {} }, journal: { append() {} } }, trace_id: 't' };
    await assert.rejects(() => IMPLEMENTATIONS['workspace.rollback'].run({ rollback_token: 'rb_x' }, ctx), (e) => e.code === CODES.POLICY_DENIED);
    const ctxA = { ...ctx, session: { session_id: 'sA', user_id: 'uA', project_id: 'pA' } };
    fs.writeFileSync(file, 'later');
    await assert.rejects(() => IMPLEMENTATIONS['workspace.rollback'].run({ rollback_token: 'rb_x' }, ctxA), (e) => e.code === CODES.REVISION_CONFLICT);
    assert.equal(fs.readFileSync(file, 'utf8'), 'later');
  });
}
module.exports = { run };
if (require.main === module) run().then(() => { const s = h.summary('SEGURIDAD :: SESSION AUTHORITY'); process.exit(s.failed ? 1 : 0); });
