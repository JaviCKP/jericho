'use strict';

const { GhostError, CODES } = require('../../core/errors');
const schema = require('../../core/memory/schema');
const { buildResume } = require('../../core/memory/resume');
const { Git } = require('../../core/git');

/**
 * Herramientas de memoria.
 *
 * El estado ya no se infiere de un Markdown: se lee de JSON validado con
 * revisión. Toda escritura usa compare-and-swap y deja historial.
 */

/** Comprueba que un trace_id existe realmente en el diario de auditoría. */
function makeTraceChecker(runtime) {
  let cache = null;
  return (traceId) => {
    if (!traceId) return false;
    if (!cache) {
      cache = new Set();
      for (const e of runtime.journal.readAll()) {
        if (e.trace_id) cache.add(e.trace_id);
      }
    }
    return cache.has(traceId);
  };
}

/* ----------------------------- memory.resume ----------------------------- */

const resume = {
  effects: () => ({}),
  async run(args, ctx) {
    const { memory, roots, registry, runner, policy } = ctx.runtime;

    if (args.action === 'list_projects') {
      const index = memory.readIndex();
      return {
        action: 'list_projects',
        projects: index.projects.map((p) => ({
          project_id: p.project_id,
          item_count: p.item_count,
          open_items: p.open_items,
        })),
      };
    }

    if (args.action === 'rules') {
      const rules = memory.getGlobalRules();
      const proposals = memory.listRuleProposals();
      return {
        action: 'rules',
        rules: {
          accepted: rules.rules || [],
          pending_proposals: proposals.map((p) => ({ proposal_id: p.proposal_id, text: p.text, created_at: p.created_at })),
          note:
            'Sólo las reglas ACEPTADAS por una persona son política. Las propuestas pendientes no lo son. ' +
            'El agente no puede aceptar sus propias propuestas.',
        },
      };
    }

    if (!args.project_id) {
      throw new GhostError(CODES.INVALID_ARGUMENT, `project_id es obligatorio para action='${args.action}'.`, {
        recoverable: true,
        remediation: 'Llama primero con action="list_projects".',
      });
    }

    if (args.action === 'list_items') {
      const items = memory.listItems(args.project_id, { status: args.status || null });
      return {
        action: 'list_items',
        items: items.map((i) => ({
          id: i.id,
          title: i.title,
          status: i.status,
          revision: i.revision,
          updated_at: i.updated_at,
          next_action: i.next_action,
          open_criteria: (i.acceptance_criteria || []).filter(
            (c) => c.mandatory !== false && !(i.evidence || []).some((e) => e.criterion_id === c.id && e.result === 'pass')
          ).length,
          corrupt: !!i.__corrupt,
        })),
      };
    }

    if (args.action === 'history') {
      if (!args.id) throw new GhostError(CODES.INVALID_ARGUMENT, 'id es obligatorio para action="history".');
      return { action: 'history', history: memory.history(args.project_id, args.id) };
    }

    // action === 'load'
    if (!args.id) {
      throw new GhostError(CODES.INVALID_ARGUMENT, 'id es obligatorio para action="load".', {
        recoverable: true,
        remediation: 'Usa action="list_items" para ver los identificadores disponibles.',
      });
    }
    const item = memory.get(args.project_id, args.id);
    const project = memory.getProject(args.project_id);
    const git = new Git(runner);

    const briefing = await buildResume({
      item,
      project,
      roots,
      git,
      registry,
      budgetChars: args.budget_chars || policy.limits.memory.resume_budget_chars,
      session: ctx.session,
      traceId: ctx.trace_id,
    });

    if (briefing.staleness.length) {
      ctx.runtime.metrics.bump('stale_memory_detected', briefing.staleness.length);
    }

    return {
      action: 'load',
      briefing,
      expected_revision: item.revision,
      __text: renderBriefing(briefing),
    };
  },
};

function renderBriefing(b) {
  const L = [];
  L.push(`=== ${b.work_item.title} (${b.work_item.id}) ===`);
  L.push(`estado: ${b.work_item.status} | revisión: ${b.work_item.revision} | proyecto: ${b.work_item.project_id}`);
  L.push('');
  L.push(`SIGUIENTE ACCIÓN: ${b.next_action}`);
  L.push('');
  if (b.staleness.length) {
    L.push('*** ESTADO OBSOLETO DETECTADO (verifica antes de actuar) ***');
    for (const s of b.staleness) L.push(`  [${s.severity}] ${s.detail}\n           -> ${s.action}`);
    L.push('');
  }
  if (b.risks.length) {
    L.push('RIESGOS:');
    for (const r of b.risks) L.push(`  - ${r}`);
    L.push('');
  }
  L.push(`OBJETIVO: ${b.work_item.goal}`);
  L.push('');
  L.push('CRITERIOS DE ACEPTACIÓN:');
  for (const c of b.acceptance_criteria) {
    L.push(`  [${c.satisfied ? 'x' : ' '}] ${c.id} ${c.text}${c.mandatory ? '' : ' (opcional)'}`);
  }
  L.push('');
  if (b.facts_verified.length) {
    L.push('HECHOS VERIFICADOS:');
    for (const f of b.facts_verified) L.push(`  - [${f.status}] ${f.text}`);
    L.push('');
  }
  if (b.assumptions_unverified.length) {
    L.push('SUPOSICIONES (NO verificadas — no las trates como hechos):');
    for (const a of b.assumptions_unverified) L.push(`  - ${a}`);
    L.push('');
  }
  if (b.git && b.git.checked) {
    L.push(`GIT: rama=${b.git.branch} head=${(b.git.head_commit || '').slice(0, 8)} limpio=${b.git.clean}`);
  }
  L.push(`\nPara escribir usa expected_revision=${b.expected_revision_for_next_write}`);
  return L.join('\n');
}

/* --------------------------- memory.checkpoint --------------------------- */

const WRITABLE_FIELDS = [
  'title', 'goal', 'status', 'acceptance_criteria', 'plan', 'completed_steps',
  'next_action', 'blockers', 'related_files', 'branch', 'base_commit',
  'verified_facts', 'assumptions',
];

const checkpoint = {
  summary: (args) => `memory.checkpoint ${args.action} en ${args.project_id}/${args.id || '(nuevo)'}`,
  effects: (args) => ({ writesFiles: true }),
  async run(args, ctx) {
    const { memory } = ctx.runtime;
    const traceExists = makeTraceChecker(ctx.runtime);

    if (args.action === 'record_decision') {
      if (!args.decision) throw new GhostError(CODES.INVALID_ARGUMENT, 'decision es obligatorio.');
      const rec = memory.recordDecision(args.project_id, {
        ...args.decision,
        sessionId: ctx.session.session_id,
        traceId: ctx.trace_id,
      });
      return { action: 'record_decision', decision: rec };
    }

    if (args.action === 'compact') {
      const summary = memory.compact(args.project_id);
      return { action: 'compact', item: summary };
    }

    if (args.action === 'restore') {
      if (!args.id || args.revision === undefined) {
        throw new GhostError(CODES.INVALID_ARGUMENT, 'id y revision son obligatorios para restore.');
      }
      const restored = memory.restore(args.project_id, args.id, args.revision, { sessionId: ctx.session.session_id });
      return {
        action: 'restore',
        id: restored.id,
        revision: restored.revision,
        status: restored.status,
        expected_revision_for_next_write: restored.revision,
      };
    }

    if (args.action === 'create') {
      const fields = {};
      for (const f of WRITABLE_FIELDS) if (args[f] !== undefined) fields[f] = args[f];
      if (args.id) fields.id = args.id;
      if (!fields.title) throw new GhostError(CODES.INVALID_ARGUMENT, 'title es obligatorio al crear un work item.');
      if (args.evidence) fields.evidence = normalizeEvidence(args.evidence);
      const { item } = memory.create(args.project_id, fields, {
        sessionId: ctx.session.session_id,
        author: ctx.session.session_id,
      });
      return {
        action: 'create',
        id: item.id,
        revision: item.revision,
        status: item.status,
        expected_revision_for_next_write: item.revision,
        item,
      };
    }

    // update / add_evidence
    if (!args.id) throw new GhostError(CODES.INVALID_ARGUMENT, 'id es obligatorio.');
    if (args.expected_revision === undefined) {
      const current = memory.get(args.project_id, args.id);
      throw new GhostError(
        CODES.INVALID_ARGUMENT,
        'expected_revision es obligatorio: es lo que impide que dos chats se pisen sin darse cuenta.',
        {
          recoverable: true,
          details: { current_revision: current.revision },
          remediation: `Usa expected_revision=${current.revision} (o vuelve a leer con memory.resume).`,
        }
      );
    }

    const patch = {};
    for (const f of WRITABLE_FIELDS) if (args[f] !== undefined) patch[f] = args[f];

    if (args.evidence) {
      const current = memory.get(args.project_id, args.id);
      const incoming = normalizeEvidence(args.evidence);
      patch.evidence = args.action === 'add_evidence' ? [...(current.evidence || []), ...incoming] : incoming;
    }

    const updated = memory.update(args.project_id, args.id, patch, {
      expectedRevision: args.expected_revision,
      sessionId: ctx.session.session_id,
      traceExists,
    });

    const completion = schema.checkCompletionEvidence(updated, traceExists);

    return {
      action: args.action,
      id: updated.id,
      revision: updated.revision,
      status: updated.status,
      expected_revision_for_next_write: updated.revision,
      completion_check: {
        can_complete: completion.ok,
        missing_evidence: completion.missing,
        unverifiable_evidence: completion.unverifiable,
      },
    };
  },
};

function normalizeEvidence(list) {
  return list.map((e) => ({ at: new Date().toISOString(), ...e }));
}

/* -------------------------- memory.propose_rule -------------------------- */

const proposeRule = {
  summary: (args) => `Proponer regla global: ${String(args.text).slice(0, 60)}`,
  effects: () => ({ writesFiles: true }),
  async run(args, ctx) {
    const p = ctx.runtime.memory.proposeGlobalRule({
      text: args.text,
      rationale: args.rationale,
      sessionId: ctx.session.session_id,
      traceId: ctx.trace_id,
    });
    return {
      proposal_id: p.proposal_id,
      status: p.status,
      how_to_accept: `Una persona debe ejecutar: npm run rules -- accept ${p.proposal_id}`,
      __text:
        `Propuesta registrada como PENDIENTE (${p.proposal_id}).\n` +
        'NO es una regla activa. El agente no puede aceptar sus propias propuestas: ' +
        `una persona debe ejecutar \`npm run rules -- accept ${p.proposal_id}\`.`,
    };
  },
};

module.exports = {
  'memory.resume': resume,
  'memory.checkpoint': checkpoint,
  'memory.propose_rule': proposeRule,
};
