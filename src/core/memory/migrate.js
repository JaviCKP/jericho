'use strict';

const fs = require('fs');
const path = require('path');
const schema = require('./schema');

/**
 * Migración reversible de la memoria v1 a v2.
 *
 * Origen v1:
 *   <workspace>/.tasks/<proyecto>/<tarea>.md   (hojas de contexto)
 *   <workspace>/.context/MEMORY_BANK.md        (reglas globales)
 *   data/long_term_memory.json                 (store_memory)
 *   data/checkpoints/*.json                    (save_context_checkpoint)
 *
 * Principios:
 *  - NO se borra nada del origen. La migración es aditiva.
 *  - Cada elemento migrado conserva `migrated_from` para poder revertir.
 *  - Se puede ejecutar en seco (`dryRun`) y es idempotente: si un id ya existe,
 *    se omite en lugar de sobrescribir.
 *  - Las reglas globales NO se aceptan automáticamente: entran como PROPUESTAS
 *    que una persona debe aprobar (así una MEMORY_BANK.md envenenada no se
 *    convierte en política sin revisión).
 */

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s.-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 100) || 'sin-nombre';
}

/** Analiza una hoja de contexto v1 en Markdown. */
function parseLegacyTaskMarkdown(content, filePath, tasksRoot) {
  const lines = content.split(/\r?\n/);
  const rel = path.relative(tasksRoot, filePath);
  const parts = rel.split(path.sep);
  const projectFromFolder = parts.length > 1 ? parts[0] : 'general';
  const filename = path.basename(filePath, '.md');

  let title = filename;
  let status = 'IN_PROGRESS';
  let project = projectFromFolder;
  let objective = '';
  const checklist = [];
  const relevantFiles = [];
  const nextSteps = [];
  let notes = '';

  let section = null;
  for (const line of lines) {
    const h1 = line.match(/^#\s+(?:Tarea:|Task:)?\s*(.+)$/);
    if (h1 && section === null) title = h1[1].trim();

    const st = line.match(/\*\*(?:Estado|Status)\*\*:\s*`?([A-Z_]+)`?/i);
    if (st) status = st[1].toUpperCase();
    const pr = line.match(/\*\*(?:Proyecto|Project)\*\*:\s*`?([^`\n\r]+)`?/i);
    if (pr) project = pr[1].trim();

    if (/^##\s/.test(line)) {
      if (/Objetivo|Objective/i.test(line)) section = 'objective';
      else if (/Archivos Relevantes|Relevant Files/i.test(line)) section = 'files';
      else if (/Checklist/i.test(line)) section = 'checklist';
      else if (/Contexto Activo|Notas|Notes/i.test(line)) section = 'notes';
      else if (/Próximos Pasos|Proximos Pasos|Next Steps/i.test(line)) section = 'next';
      else section = null;
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;
    if (section === 'objective') objective += (objective ? '\n' : '') + trimmed;
    else if (section === 'notes') notes += (notes ? '\n' : '') + trimmed;
    else if (section === 'files') {
      const m = trimmed.match(/^-\s*`([^`]+)`/);
      if (m) relevantFiles.push(m[1]);
    } else if (section === 'checklist') {
      const m = trimmed.match(/^-\s*\[([ xX])\]\s*(.+)$/);
      if (m) checklist.push({ done: m[1].toLowerCase() === 'x', text: m[2].trim() });
    } else if (section === 'next') {
      const m = trimmed.match(/^\d+\.\s*(.+)$/) || trimmed.match(/^-\s*(.+)$/);
      if (m) nextSteps.push(m[1].trim());
    }
  }

  const VALID = ['DRAFT', 'IN_PROGRESS', 'BLOCKED', 'PAUSED', 'COMPLETED', 'ABANDONED'];
  if (!VALID.includes(status)) status = 'IN_PROGRESS';

  return { title, status, project, objective, checklist, relevantFiles, nextSteps, notes, filename, sourcePath: filePath };
}

/**
 * Convierte una hoja v1 en un work item v2.
 *
 * IMPORTANTE sobre COMPLETED: en v1 el estado era texto libre sin evidencia.
 * Migrar eso como COMPLETED reintroduciría exactamente el problema P1-3, así
 * que toda hoja COMPLETED entra como `PAUSED` con un aviso explícito y los
 * pasos marcados se conservan como `completed_steps`.
 */
function legacyToWorkItem(legacy, projectId, now = new Date().toISOString()) {
  const criteria = legacy.checklist.map((c, i) => ({
    id: `c${i + 1}`,
    // El texto de v1 podía venir vacío o ser sólo un guion.
    text: (c.text && c.text.trim().length >= 3 ? c.text.trim() : `(paso ${i + 1} migrado sin descripción)`).slice(0, 1000),
    // Nada migrado tiene evidencia verificable, así que ningún criterio se
    // marca obligatorio automáticamente: quedan como opcionales hasta que
    // una persona o el agente los revise. `verify` se omite (no se pone null:
    // el esquema exige texto si el campo está presente).
    mandatory: false,
  }));

  const wasCompleted = legacy.status === 'COMPLETED';

  return schema.emptyWorkItem({
    id: slugify(legacy.filename),
    project_id: projectId,
    revision: 1,
    status: wasCompleted ? 'PAUSED' : legacy.status,
    title: legacy.title || legacy.filename,
    goal: legacy.objective || '(migrado de v1 sin objetivo explícito)',
    acceptance_criteria: criteria,
    plan: legacy.checklist.filter((c) => !c.done).map((c) => c.text),
    completed_steps: legacy.checklist.filter((c) => c.done).map((c) => c.text),
    next_action: legacy.nextSteps[0] || '(revisar el estado migrado antes de continuar)',
    blockers: wasCompleted
      ? ['MIGRACIÓN: esta hoja figuraba COMPLETED en v1 sin evidencia verificable. Se migró como PAUSED. Añade criterios obligatorios y evidencia real antes de cerrarla.']
      : [],
    related_files: legacy.relevantFiles,
    assumptions: [
      'Migrado automáticamente desde una hoja Markdown v1: el contenido no está verificado.',
      ...(legacy.notes ? [`Notas v1: ${legacy.notes.slice(0, 500)}`] : []),
    ],
    verified_facts: [],
    evidence: [],
    created_at: now,
    updated_at: now,
    author: 'migration:v1->v2',
    migrated_from: {
      schema_version: 1,
      source_path: legacy.sourcePath,
      original_status: legacy.status,
      migrated_at: now,
    },
  });
}

/**
 * Ejecuta la migración completa.
 *
 * @param {object} opts
 * @param {MemoryStore} opts.store
 * @param {string} opts.workspaceDir   raíz que contenía .tasks y .context
 * @param {string} opts.dataDir        para long_term_memory.json y checkpoints
 * @param {boolean} opts.dryRun
 * @returns {object} informe detallado
 */
function migrate({ store, workspaceDir, dataDir, dryRun = true }) {
  const report = {
    dry_run: dryRun,
    started_at: new Date().toISOString(),
    tasks: { found: 0, migrated: 0, skipped_existing: 0, errors: [] },
    memory_bank: { found: false, rules_proposed: 0 },
    long_term_memory: { found: 0, migrated: 0 },
    checkpoints: { found: 0, migrated: 0 },
    projects: new Set(),
    notes: [],
  };

  /* ------------------------------ 1. .tasks ------------------------------ */
  const tasksRoot = path.join(workspaceDir, '.tasks');
  if (fs.existsSync(tasksRoot)) {
    const files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.md')) files.push(p);
      }
    };
    walk(tasksRoot);
    report.tasks.found = files.length;

    for (const file of files) {
      try {
        const legacy = parseLegacyTaskMarkdown(fs.readFileSync(file, 'utf-8'), file, tasksRoot);
        const projectId = slugify(legacy.project);
        report.projects.add(projectId);
        const item = legacyToWorkItem(legacy, projectId);
        schema.validateWorkItem(item);

        if (!dryRun) {
          store.ensureProject(projectId, { notes: 'Proyecto migrado desde .tasks/ v1' });
          const existing = store.listItems(projectId).find((i) => i.id === item.id);
          if (existing) {
            report.tasks.skipped_existing++;
            continue;
          }
          store.create(projectId, item, { author: 'migration:v1->v2' });
        }
        report.tasks.migrated++;
      } catch (err) {
        report.tasks.errors.push({ file, error: err.message });
      }
    }
  }

  /* --------------------------- 2. MEMORY_BANK.md --------------------------- */
  const bankFile = path.join(workspaceDir, '.context', 'MEMORY_BANK.md');
  if (fs.existsSync(bankFile)) {
    report.memory_bank.found = true;
    const content = fs.readFileSync(bankFile, 'utf-8');
    const rules = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^[-*]\s+/.test(l))
      .map((l) => l.replace(/^[-*]\s+/, '').replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/, ''))
      .filter((l) => l.length > 4);

    for (const text of rules) {
      if (!dryRun) {
        store.proposeGlobalRule({
          text,
          rationale: 'Migrado desde .context/MEMORY_BANK.md (v1). Requiere aprobación humana antes de ser regla.',
          sessionId: 'migration',
        });
      }
      report.memory_bank.rules_proposed++;
    }
    report.notes.push(
      'Las reglas de MEMORY_BANK.md se migraron como PROPUESTAS pendientes, no como reglas activas: ' +
        'en v1 cualquier contenido podía escribirlas sin aprobación. Revísalas con `npm run rules -- list`.'
    );
  }

  /* ----------------------- 3. long_term_memory.json ----------------------- */
  const ltmFile = path.join(dataDir, 'long_term_memory.json');
  if (fs.existsSync(ltmFile)) {
    try {
      const memories = JSON.parse(fs.readFileSync(ltmFile, 'utf-8'));
      report.long_term_memory.found = Array.isArray(memories) ? memories.length : 0;
      if (Array.isArray(memories) && memories.length) {
        const projectId = 'memoria-global';
        report.projects.add(projectId);
        if (!dryRun) {
          store.ensureProject(projectId, { notes: 'Memorias sueltas migradas de store_memory v1' });
          for (const m of memories) {
            store.recordDecision(projectId, {
              title: `memoria: ${m.key}`,
              context: `Migrado de long_term_memory.json (v1). Etiquetas: ${(m.tags || []).join(', ') || 'ninguna'}`,
              decision: m.value,
              consequences: 'Sin verificar. Trátalo como suposición hasta confirmarlo.',
              sessionId: 'migration',
            });
          }
        }
        report.long_term_memory.migrated = memories.length;
      }
    } catch (err) {
      report.notes.push(`long_term_memory.json ilegible: ${err.message}`);
    }
  }

  /* --------------------------- 4. checkpoints --------------------------- */
  const ckptDir = path.join(dataDir, 'checkpoints');
  if (fs.existsSync(ckptDir)) {
    const files = fs.readdirSync(ckptDir).filter((f) => f.endsWith('.json'));
    report.checkpoints.found = files.length;
    for (const f of files) {
      try {
        const c = JSON.parse(fs.readFileSync(path.join(ckptDir, f), 'utf-8'));
        const projectId = slugify(c.project || 'general');
        report.projects.add(projectId);
        if (!dryRun) {
          store.ensureProject(projectId);
          store.appendProjectJournal(projectId, {
            kind: 'checkpoint.migrated',
            checkpoint_id: c.id,
            title: c.title,
            summary: c.summary,
            modified_files: c.modifiedFiles,
            next_steps: c.nextSteps,
            original_timestamp: c.timestamp,
          });
        }
        report.checkpoints.migrated++;
      } catch (err) {
        report.notes.push(`checkpoint ${f} ilegible: ${err.message}`);
      }
    }
  }

  report.projects = [...report.projects];
  report.finished_at = new Date().toISOString();
  report.reversible = true;
  report.rollback_instructions =
    'La migración es aditiva: no borra .tasks/, .context/, long_term_memory.json ni checkpoints/. ' +
    'Para revertir, borra el directorio data/memory/ y vuelve a arrancar con JERICHO_PROFILES sin memoria v2. ' +
    'Cada work item migrado conserva `migrated_from.source_path`.';
  return report;
}

module.exports = { migrate, parseLegacyTaskMarkdown, legacyToWorkItem, slugify };
