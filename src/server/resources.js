'use strict';

const { GhostError, CODES } = require('../core/errors');
const redact = require('../core/redact');

/**
 * MCP Resources.
 *
 * La memoria, la política y la actividad se exponen como RECURSOS, no como
 * herramientas. Así el cliente puede mostrarlos o adjuntarlos sin gastar una
 * llamada a herramienta ni presupuesto de esquema.
 *
 * Todos son de sólo lectura y pasan por la capa de redacción.
 */

const RESOURCES = [
  {
    uri: 'ghostpc://policy',
    name: 'Política efectiva',
    description: 'Perfiles, riesgo máximo, raíces autorizadas, destinos de red, límites y concesiones permanentes.',
    mimeType: 'application/json',
  },
  {
    uri: 'ghostpc://memory/index',
    name: 'Índice de memoria',
    description: 'Proyectos y work items con su estado y revisión. Índice derivado, reconstruible.',
    mimeType: 'application/json',
  },
  {
    uri: 'ghostpc://rules',
    name: 'Reglas globales',
    description: 'Reglas aceptadas por una persona y propuestas pendientes (que NO son reglas).',
    mimeType: 'application/json',
  },
  {
    uri: 'ghostpc://activity',
    name: 'Actividad reciente',
    description: 'Últimas operaciones del diario de auditoría, con verificación de la cadena de hashes.',
    mimeType: 'application/json',
  },
  {
    uri: 'ghostpc://approvals',
    name: 'Aprobaciones pendientes',
    description: 'Operaciones bloqueadas esperando decisión humana.',
    mimeType: 'application/json',
  },
];

const TEMPLATES = [
  {
    uriTemplate: 'ghostpc://memory/{project_id}/{item_id}',
    name: 'Work item',
    description: 'Estado completo de un work item (JSON versionado con revisión, criterios y evidencia).',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'ghostpc://memory/{project_id}/{item_id}/markdown',
    name: 'Work item (vista Markdown)',
    description: 'Vista legible por personas del mismo work item. Derivada: no es fuente de verdad.',
    mimeType: 'text/markdown',
  },
];

function requireContext(runtime, context) {
  if (!context || context.session_id === 'anon' || !context.user_id || !context.project_id) {
    throw new GhostError(CODES.POLICY_DENIED, 'Recurso sensible requiere contexto autenticado.');
  }
  return context;
}

function listResources(runtime, context) {
  requireContext(runtime, context);
  const dynamic = [];
  try {
    const index = runtime.memory.readIndex();
    for (const p of index.projects.filter((p) => p.project_id === context.project_id)) {
      for (const item of p.items.slice(0, 50)) {
        dynamic.push({
          uri: `ghostpc://memory/${p.project_id}/${item.id}`,
          name: `${p.project_id} / ${item.title || item.id}`,
          description: `${item.status} · rev ${item.revision} · siguiente: ${String(item.next_action || '').slice(0, 80)}`,
          mimeType: 'application/json',
        });
      }
    }
  } catch (e) {
    /* si la memoria no es legible, se listan sólo los recursos fijos */
  }
  return { resources: [...RESOURCES, ...dynamic] };
}

function listResourceTemplates() {
  return { resourceTemplates: TEMPLATES };
}

function json(uri, value) {
  return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(redact.redactValue(value), null, 2) }] };
}

function readResource(runtime, uri, context) {
  requireContext(runtime, context);
  if (uri === 'ghostpc://policy') {
    return json(uri, runtime.engine.describe());
  }
  if (uri === 'ghostpc://memory/index') {
    const index = runtime.memory.readIndex();
    return json(uri, { ...index, projects: index.projects.filter((p) => p.project_id === context.project_id) });
  }
  if (uri === 'ghostpc://rules') {
    return json(uri, {
      accepted: runtime.memory.getGlobalRules().rules,
      pending_proposals: runtime.memory.listRuleProposals(),
      note: 'Sólo las reglas aceptadas por una persona son política. El agente no puede aceptar sus propias propuestas.',
    });
  }
  if (uri === 'ghostpc://activity') {
    const recent = runtime.journal.tail(60).filter((e) => e.session_id === context.session_id && e.project_id === context.project_id);
    return json(uri, {
      chain: runtime.journal.verify(),
      // Métricas globales no se exponen: no existe un contador seguro por
      // sesión en este recurso y mezclarlo rompe aislamiento A/B.
      metrics: { scoped: true },
      recent,
    });
  }
  if (uri === 'ghostpc://approvals') {
    return json(uri, {
      pending: runtime.approvals.listPending().filter((a) => a.session_id === context.session_id && a.user_id === context.user_id && a.project_id === context.project_id),
      how_to_approve: 'npm run approve -- <approval_id>',
    });
  }

  const m = uri.match(/^ghostpc:\/\/memory\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)(\/markdown)?$/);
  if (m) {
    const [, projectId, itemId, asMarkdown] = m;
    if (projectId !== context.project_id) throw new GhostError(CODES.POLICY_DENIED, 'El recurso pertenece a otro proyecto.');
    const item = runtime.memory.get(projectId, itemId);
    if (asMarkdown) {
      const { renderWorkItemMarkdown } = require('../core/memory/render');
      return { contents: [{ uri, mimeType: 'text/markdown', text: renderWorkItemMarkdown(item) }] };
    }
    return json(uri, item);
  }

  throw new GhostError(CODES.NOT_FOUND, `Recurso desconocido: ${uri}`, {
    details: { available: RESOURCES.map((r) => r.uri), templates: TEMPLATES.map((t) => t.uriTemplate) },
  });
}

module.exports = { RESOURCES, TEMPLATES, listResources, listResourceTemplates, readResource };
