'use strict';

/**
 * Vista Markdown DERIVADA de un work item.
 *
 * Es para que una persona pueda leer y revisar el estado con cualquier editor.
 * NO es fuente de verdad: si se edita a mano, la próxima escritura lo regenera.
 * Por eso lleva una cabecera que lo dice explícitamente.
 */

function checkbox(done) {
  return done ? '- [x]' : '- [ ]';
}

function renderWorkItemMarkdown(item) {
  const passing = new Set(
    (item.evidence || []).filter((e) => e.result === 'pass').map((e) => e.criterion_id)
  );

  const lines = [];
  lines.push(`<!-- VISTA GENERADA POR GhostPC. Fuente de verdad: ${item.id}.json`);
  lines.push('     Editar este .md NO cambia el estado: se regenera en la próxima escritura. -->');
  lines.push('');
  lines.push(`# ${item.title}`);
  lines.push('');
  lines.push(`| campo | valor |`);
  lines.push(`|---|---|`);
  lines.push(`| id | \`${item.id}\` |`);
  lines.push(`| proyecto | \`${item.project_id}\` |`);
  lines.push(`| estado | **${item.status}** |`);
  lines.push(`| revisión | ${item.revision} |`);
  lines.push(`| rama | \`${item.branch || '(sin registrar)'}\` |`);
  lines.push(`| commit base | \`${item.base_commit || '(sin registrar)'}\` |`);
  lines.push(`| actualizado | ${item.updated_at} |`);
  lines.push(`| sesión | \`${item.session_id || '(anónima)'}\` |`);
  lines.push('');

  lines.push('## Objetivo');
  lines.push(item.goal || '_(sin objetivo declarado)_');
  lines.push('');

  lines.push('## Criterios de aceptación');
  if (!item.acceptance_criteria || item.acceptance_criteria.length === 0) {
    lines.push('_(ninguno declarado — este work item NO puede pasar a COMPLETED)_');
  } else {
    for (const c of item.acceptance_criteria) {
      const mark = checkbox(passing.has(c.id));
      const mandatory = c.mandatory === false ? ' _(opcional)_' : '';
      lines.push(`${mark} \`${c.id}\` ${c.text}${mandatory}`);
      if (c.verify) lines.push(`  - verificación: ${c.verify}`);
    }
  }
  lines.push('');

  lines.push('## Evidencia');
  if (!item.evidence || item.evidence.length === 0) {
    lines.push('_(sin evidencia registrada)_');
  } else {
    lines.push('| criterio | tipo | resultado | trace_id | cuándo |');
    lines.push('|---|---|---|---|---|');
    for (const e of item.evidence) {
      lines.push(`| \`${e.criterion_id}\` | ${e.kind} | ${e.result} | \`${e.trace_id || '-'}\` | ${e.at} |`);
    }
  }
  lines.push('');

  lines.push('## Plan');
  if (!item.plan || !item.plan.length) lines.push('_(sin plan)_');
  else item.plan.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
  lines.push('');

  lines.push('## Pasos completados');
  if (!item.completed_steps || !item.completed_steps.length) lines.push('_(ninguno)_');
  else item.completed_steps.forEach((p) => lines.push(`- ${p}`));
  lines.push('');

  lines.push('## Siguiente acción');
  lines.push(item.next_action || '_(sin definir)_');
  lines.push('');

  if (item.blockers && item.blockers.length) {
    lines.push('## Bloqueos');
    item.blockers.forEach((b) => lines.push(`- ${b}`));
    lines.push('');
  }

  lines.push('## Hechos verificados');
  if (!item.verified_facts || !item.verified_facts.length) lines.push('_(ninguno)_');
  else {
    for (const f of item.verified_facts) {
      lines.push(`- ${f.text} _(${f.volatility || 'stable'}${f.verified_at ? `, verificado ${f.verified_at}` : ''})_`);
    }
  }
  lines.push('');

  lines.push('## Suposiciones (NO verificadas)');
  if (!item.assumptions || !item.assumptions.length) lines.push('_(ninguna)_');
  else item.assumptions.forEach((a) => lines.push(`- ${a}`));
  lines.push('');

  lines.push('## Archivos relacionados');
  if (!item.related_files || !item.related_files.length) lines.push('_(ninguno)_');
  else item.related_files.forEach((f) => lines.push(`- \`${f}\``));
  lines.push('');

  return lines.join('\n');
}

module.exports = { renderWorkItemMarkdown };
