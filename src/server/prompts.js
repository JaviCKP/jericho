'use strict';

const { GhostError, CODES } = require('../core/errors');

/**
 * MCP Prompts: flujos seleccionables por la PERSONA.
 *
 * Son plantillas que el usuario elige explícitamente en su cliente. No sustituyen
 * a la política del servidor: describen cómo trabajar bien dentro de ella.
 */

const PROMPTS = [
  {
    name: 'reanudar-trabajo',
    title: 'Reanudar trabajo en un proyecto',
    description: 'Carga el contexto verificando la realidad (rama, commits, archivos, procesos) antes de tocar nada.',
    arguments: [
      { name: 'project_id', description: 'Proyecto a reanudar', required: true },
      { name: 'item_id', description: 'Work item concreto (opcional)', required: false },
      { name: 'session_id', description: 'Identificador de esta sesión', required: false },
    ],
  },
  {
    name: 'planificar-cambio',
    title: 'Planificar un cambio con criterios de aceptación',
    description: 'Crea un work item con criterios verificables ANTES de escribir código.',
    arguments: [
      { name: 'project_id', description: 'Proyecto', required: true },
      { name: 'objetivo', description: 'Qué se quiere conseguir', required: true },
      { name: 'session_id', description: 'Identificador de esta sesión', required: false },
    ],
  },
  {
    name: 'verificar-y-cerrar',
    title: 'Verificar y cerrar un work item',
    description: 'Ejecuta las verificaciones reales y sólo entonces cierra la tarea con evidencia.',
    arguments: [
      { name: 'project_id', description: 'Proyecto', required: true },
      { name: 'item_id', description: 'Work item a cerrar', required: true },
      { name: 'session_id', description: 'Identificador de esta sesión', required: false },
    ],
  },
  {
    name: 'revisar-antes-de-commit',
    title: 'Revisar los cambios antes de hacer commit',
    description: 'Revisa el diff completo, comprueba que no hay secretos y hace commit sólo de lo tuyo.',
    arguments: [
      { name: 'project_id', description: 'Proyecto', required: true },
      { name: 'session_id', description: 'Identificador de esta sesión', required: false },
    ],
  },
];

function text(t) {
  return { role: 'user', content: { type: 'text', text: t } };
}

function getPrompt(runtime, name, args) {
  const sid = args.session_id || '<elige un session_id estable para esta conversación>';

  switch (name) {
    case 'reanudar-trabajo':
      return {
        description: `Reanudar ${args.project_id}${args.item_id ? ` / ${args.item_id}` : ''}`,
        messages: [
          text(
            `Reanuda el trabajo en el proyecto "${args.project_id}".\n\n` +
              `Pasos, en este orden:\n` +
              `1. ghostpc.status para conocer los límites reales.\n` +
              `2. memory.resume(action="${args.item_id ? 'load' : 'list_items'}", project_id="${args.project_id}"` +
              `${args.item_id ? `, id="${args.item_id}"` : ''}, session_id="${sid}").\n` +
              `3. Lee con atención el bloque "staleness": indica qué ha cambiado desde la última sesión ` +
              `(rama, commits, archivos, procesos). NO des por buena ninguna suposición marcada como no verificada.\n` +
              `4. Antes de proponer nada, dime en dos frases: qué está hecho de verdad (con evidencia), ` +
              `qué está obsoleto y cuál es la siguiente acción.\n\n` +
              `No empieces a editar hasta que confirme el plan.`
          ),
        ],
      };

    case 'planificar-cambio':
      return {
        description: `Planificar: ${args.objetivo}`,
        messages: [
          text(
            `Objetivo: ${args.objetivo}\nProyecto: ${args.project_id}\n\n` +
              `Antes de escribir código:\n` +
              `1. Explora con workspace.inspect / workspace.search / workspace.read para entender el estado real.\n` +
              `2. Crea un work item con memory.checkpoint(action="create", project_id="${args.project_id}", session_id="${sid}") ` +
              `que incluya criterios de aceptación VERIFICABLES: cada uno debe poder comprobarse con verify.run ` +
              `o con una comprobación concreta. Nada de "funciona bien".\n` +
              `3. Registra en verified_facts sólo lo que hayas COMPROBADO, y en assumptions lo que supones.\n` +
              `4. Enséñame el plan y los criterios antes de tocar ningún archivo.`
          ),
        ],
      };

    case 'verificar-y-cerrar':
      return {
        description: `Cerrar ${args.project_id}/${args.item_id}`,
        messages: [
          text(
            `Cierra el work item "${args.item_id}" del proyecto "${args.project_id}".\n\n` +
              `1. memory.resume(action="load", ...) para ver qué criterios siguen sin evidencia.\n` +
              `2. Para CADA criterio obligatorio sin evidencia, ejecuta la verificación real con verify.run ` +
              `y guarda el trace_id que devuelve.\n` +
              `3. memory.checkpoint(action="add_evidence", expected_revision=<el que te dio resume>) con esas evidencias.\n` +
              `4. Sólo cuando completion_check.can_complete sea true, pon status="COMPLETED".\n\n` +
              `Si alguna verificación falla, NO cierres la tarea: dime qué falla y por qué.`
          ),
        ],
      };

    case 'revisar-antes-de-commit':
      return {
        description: `Revisión previa al commit en ${args.project_id}`,
        messages: [
          text(
            `Antes de hacer commit en "${args.project_id}":\n\n` +
              `1. git.inspect(action="status") y git.inspect(action="diff") — revisa el diff COMPLETO.\n` +
              `2. Comprueba que no hay credenciales, tokens ni rutas personales en los cambios.\n` +
              `3. Identifica qué archivos son TUYOS de esta sesión. Si hay cambios que no reconoces, ` +
              `pueden ser de otra sesión o míos: pregúntame antes de incluirlos.\n` +
              `4. git.commit(action="commit", files=[...sólo los tuyos...], message="...").\n` +
              `5. Guarda el hash y el comando de rollback que devuelve.`
          ),
        ],
      };

    default:
      throw new GhostError(CODES.NOT_FOUND, `Prompt desconocido: ${name}`, {
        details: { available: PROMPTS.map((p) => p.name) },
      });
  }
}

module.exports = { PROMPTS, getPrompt };
