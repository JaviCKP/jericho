'use strict';

const fs = require('fs');
const path = require('path');
const { sha256File } = require('../atomic');

/**
 * Reanudación con detección de estado obsoleto.
 *
 * El problema del prototipo: `resume_task_session` volcaba el Markdown tal cual
 * y previsualizaba archivos. Si la rama había cambiado, si otro chat había
 * tocado los archivos o si el proceso registrado ya no existía, el modelo
 * seguía creyendo el texto.
 *
 * Aquí se COMPRUEBA la realidad y se marca explícitamente lo que ya no es cierto.
 * La salida separa hechos, suposiciones, riesgos y siguiente acción, y respeta
 * un presupuesto de caracteres.
 */

const VOLATILE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 h

async function buildResume({
  item,
  project,
  roots,
  git,
  registry,
  budgetChars = 12_000,
  session = {},
  traceId = null,
}) {
  const staleness = [];
  const facts = [];
  const risks = [];

  /* ------------------------------ 1. Git ------------------------------ */
  let gitState = { checked: false };
  const repoPath = resolveRepoPath(project, roots);
  if (repoPath && git) {
    const ctx = { session, traceId, tool: 'memory.resume' };
    const isRepo = await git.isRepo(repoPath, ctx);
    if (isRepo) {
      const [branch, head, status] = await Promise.all([
        git.branch(repoPath, ctx),
        git.headCommit(repoPath, ctx),
        git.statusPorcelain(repoPath, ctx),
      ]);
      gitState = {
        checked: true,
        repo_path: repoPath,
        branch,
        head_commit: head,
        clean: status.clean,
        changed_files: status.entries.slice(0, 50),
        changed_count: status.entries.length,
      };

      if (item.branch && branch && item.branch !== branch) {
        staleness.push({
          kind: 'branch_changed',
          severity: 'high',
          detail: `El work item se guardó en la rama '${item.branch}' pero ahora estás en '${branch}'.`,
          action: 'Confirma si debes cambiar de rama antes de continuar.',
        });
      }
      if (item.base_commit && head && item.base_commit !== head) {
        staleness.push({
          kind: 'commit_moved',
          severity: 'medium',
          detail: `El commit base registrado (${short(item.base_commit)}) ya no es HEAD (${short(head)}). Hubo commits desde entonces.`,
          action: 'Revisa git.inspect(log) antes de dar por válido el plan guardado.',
        });
      }
      if (!status.clean) {
        risks.push(
          `El árbol de trabajo tiene ${status.entries.length} cambios sin commitear. ` +
            'Pueden ser de otra sesión: no uses `git add` masivo.'
        );
      }
    } else {
      gitState = { checked: true, repo_path: repoPath, is_repo: false };
    }
  }

  /* -------------------------- 2. Archivos relacionados -------------------------- */
  const files = [];
  for (const rel of (item.related_files || []).slice(0, 30)) {
    const resolved = roots.tryResolve(rel, { root: project && project.root ? project.root : undefined });
    if (!resolved) {
      files.push({ path: rel, status: 'inaccesible', note: 'fuera de las raíces autorizadas o excluido por política' });
      staleness.push({
        kind: 'file_unreachable',
        severity: 'medium',
        detail: `El archivo relacionado '${rel}' no es accesible bajo la política actual.`,
        action: 'Actualiza related_files o revisa las raíces autorizadas.',
      });
      continue;
    }
    if (!resolved.exists) {
      files.push({ path: resolved.relative, status: 'no_existe' });
      staleness.push({
        kind: 'file_missing',
        severity: 'high',
        detail: `El archivo '${resolved.relative}' ya no existe.`,
        action: 'Puede haberse renombrado o borrado. Verifícalo antes de asumir su contenido.',
      });
      continue;
    }
    let hash = null;
    let size = null;
    let mtime = null;
    try {
      const st = fs.statSync(resolved.absolute);
      size = st.size;
      mtime = st.mtime.toISOString();
      if (st.size <= 2_000_000) hash = sha256File(resolved.absolute);
    } catch (e) {
      /* ignorado: se reporta como sin hash */
    }
    const recorded = (item.file_hashes || {})[resolved.relative];
    const changed = recorded && hash && recorded !== hash;
    if (changed) {
      staleness.push({
        kind: 'file_changed',
        severity: 'high',
        detail: `'${resolved.relative}' cambió desde la última sesión (hash distinto).`,
        action: 'Vuelve a leerlo antes de aplicar parches basados en el contenido antiguo.',
      });
    }
    files.push({
      path: resolved.relative,
      status: changed ? 'modificado_desde_la_ultima_sesion' : 'ok',
      size_bytes: size,
      modified_at: mtime,
      sha256: hash ? hash.slice(0, 16) : null,
    });
  }

  /* ---------------------------- 3. Procesos ---------------------------- */
  const processes = [];
  for (const p of registry ? registry.list({ sessionId: session.session_id }) : []) {
    const alive = p.status === 'RUNNING' && registryAlive(registry, p.pid);
    processes.push({ proc_id: p.proc_id, program: p.program, status: alive ? 'RUNNING' : 'DEAD', pid: p.pid });
    if (p.status === 'RUNNING' && !alive) {
      staleness.push({
        kind: 'process_dead',
        severity: 'low',
        detail: `El proceso ${p.proc_id} (${p.program}) figuraba en ejecución pero ya no existe.`,
        action: 'Vuelve a lanzarlo si lo necesitas.',
      });
    }
  }

  /* -------------------- 4. Hechos volátiles caducados -------------------- */
  const now = Date.now();
  for (const f of item.verified_facts || []) {
    const isVolatile = f.volatility === 'volatile';
    const age = f.verified_at ? now - Date.parse(f.verified_at) : Infinity;
    if (isVolatile && age > VOLATILE_MAX_AGE_MS) {
      facts.push({ text: f.text, status: 'OBSOLETO', verified_at: f.verified_at || null });
      staleness.push({
        kind: 'volatile_fact_stale',
        severity: 'medium',
        detail: `Hecho volátil sin reverificar desde ${f.verified_at || 'nunca'}: "${truncate(f.text, 120)}".`,
        action: 'Vuelve a comprobarlo antes de usarlo como premisa.',
      });
    } else {
      facts.push({ text: f.text, status: 'VIGENTE', verified_at: f.verified_at || null });
    }
  }

  /* --------------------- 5. Evidencia y estado --------------------- */
  const criteria = (item.acceptance_criteria || []).map((c) => {
    const ev = (item.evidence || []).filter((e) => e.criterion_id === c.id);
    const passing = ev.filter((e) => e.result === 'pass');
    return {
      id: c.id,
      text: c.text,
      mandatory: c.mandatory !== false,
      satisfied: passing.length > 0,
      evidence_count: ev.length,
    };
  });
  const unmet = criteria.filter((c) => c.mandatory && !c.satisfied);
  if (item.status === 'COMPLETED' && unmet.length) {
    risks.push(
      `INCOHERENCIA: el work item figura COMPLETED pero ${unmet.length} criterios obligatorios no tienen evidencia. ` +
        'Trátalo como NO completado.'
    );
  }

  /* ------------------------- 6. Presupuesto ------------------------- */
  const briefing = {
    work_item: {
      id: item.id,
      project_id: item.project_id,
      title: item.title,
      status: item.status,
      revision: item.revision,
      updated_at: item.updated_at,
      goal: truncate(item.goal, 1200),
    },
    // La siguiente acción va primero: es lo que hay que hacer.
    next_action: item.next_action || '(sin definir — decídela antes de tocar código)',
    blockers: item.blockers || [],
    acceptance_criteria: criteria,
    facts_verified: facts,
    assumptions_unverified: item.assumptions || [],
    risks,
    staleness,
    git: gitState,
    files,
    processes,
    plan_remaining: (item.plan || []).filter((p) => !(item.completed_steps || []).includes(p)).slice(0, 20),
    completed_steps: (item.completed_steps || []).slice(-10),
    expected_revision_for_next_write: item.revision,
  };

  return applyBudget(briefing, budgetChars);
}

/* ------------------------------ utilidades ------------------------------ */

function registryAlive(registry, pid) {
  try {
    const { ProcessRegistry } = require('../exec/registry');
    return ProcessRegistry.isAlive(pid);
  } catch (e) {
    return false;
  }
}

function resolveRepoPath(project, roots) {
  if (project && project.repo_path) {
    const r = roots.tryResolve(project.repo_path, { root: project.root || undefined });
    if (r && r.exists) return r.absolute;
  }
  if (project && project.root) {
    const rootDef = roots.byName(project.root);
    if (rootDef) return rootDef.path;
  }
  const first = roots.list()[0];
  return first ? first.path : null;
}

function short(hash) {
  return typeof hash === 'string' ? hash.slice(0, 8) : hash;
}

function truncate(text, n) {
  if (typeof text !== 'string') return text;
  return text.length <= n ? text : text.slice(0, n) + `… [+${text.length - n} caracteres]`;
}

/**
 * Recorta el briefing para caber en el presupuesto de contexto, quitando primero
 * lo menos crítico. `next_action`, `staleness` y `risks` nunca se eliminan.
 */
function applyBudget(briefing, budgetChars) {
  const order = ['completed_steps', 'files', 'processes', 'plan_remaining', 'facts_verified', 'assumptions_unverified'];
  const result = { ...briefing, _budget: { limit_chars: budgetChars, trimmed: [] } };
  for (const key of order) {
    if (JSON.stringify(result).length <= budgetChars) break;
    const value = result[key];
    if (Array.isArray(value) && value.length > 3) {
      result[key] = value.slice(0, 3);
      result._budget.trimmed.push(`${key} recortado a 3 de ${value.length}`);
    }
  }
  if (JSON.stringify(result).length > budgetChars) {
    result.work_item.goal = truncate(result.work_item.goal, 400);
    result._budget.trimmed.push('goal recortado');
  }
  result._budget.final_chars = JSON.stringify(result).length;
  return result;
}

module.exports = { buildResume, VOLATILE_MAX_AGE_MS };
