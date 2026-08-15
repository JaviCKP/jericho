const fs = require('fs');
const path = require('path');
const { formatTextResponse } = require('../utils/helpers');
const config = require('../config');

// Directorio dedicado para tareas en Markdown
const tasksDir = path.join(config.workspaceDir, '.tasks');
const memoryFile = path.join(config.dataDir, 'global_memory_bank.md');

if (!fs.existsSync(tasksDir)) {
  fs.mkdirSync(tasksDir, { recursive: true });
}

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

function getTaskFilePath(taskId) {
  const cleanId = taskId.endsWith('.md') ? taskId : `${taskId}.md`;
  return path.join(tasksDir, cleanId);
}

function parseTaskMarkdown(content, filename) {
  const lines = content.split(/\r?\n/);
  let title = filename.replace('.md', '');
  let status = 'OPEN';
  let project = 'General';
  let lastUpdated = '';

  for (const line of lines.slice(0, 15)) {
    if (line.startsWith('# Task:') || line.startsWith('# Tarea:')) {
      title = line.replace(/# (Task|Tarea):/, '').trim();
    }
    const statusMatch = line.match(/\*\*Estado\*\*:\s*`?([A-Z_]+)`?/i) || line.match(/\*\*Status\*\*:\s*`?([A-Z_]+)`?/i);
    if (statusMatch) status = statusMatch[1].toUpperCase();

    const projMatch = line.match(/\*\*Proyecto\*\*:\s*`?([^`\n\r]+)`?/i) || line.match(/\*\*Project\*\*:\s*`?([^`\n\r]+)`?/i);
    if (projMatch) project = projMatch[1].trim();

    const dateMatch = line.match(/\*\*Actualizado\*\*:\s*`?([^`\n\r]+)`?/i) || line.match(/\*\*Updated\*\*:\s*`?([^`\n\r]+)`?/i);
    if (dateMatch) lastUpdated = dateMatch[1].trim();
  }

  return {
    taskId: filename.replace('.md', ''),
    title: title,
    status: status,
    project: project,
    lastUpdated: lastUpdated,
    filePath: path.join(tasksDir, filename),
    rawContent: content,
  };
}

const taskEngineTools = [
  {
    name: 'task_session',
    description: 'Gestiona tareas de trabajo persistentes almacenadas como documentos Markdown (.md) en el PC. Permite iniciar tareas, cargar contexto acumulado para reanudar sesiones en nuevos chats, actualizar checklists y registrar decisiones arquitectónicas.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'load', 'update', 'list', 'archive'],
          description: 'Acción a realizar sobre las tareas.',
        },
        taskId: {
          type: 'string',
          description: 'Identificador único de la tarea (ej. "auth-jwt", "rediseño-landing"). Requerido para create, load y update.',
        },
        title: {
          type: 'string',
          description: 'Título descriptivo de la tarea.',
        },
        project: {
          type: 'string',
          description: 'Proyecto asociado o ruta en disco (ej. "mi-app-web").',
        },
        objective: {
          type: 'string',
          description: 'Objetivo principal de la tarea.',
        },
        checklist: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista de ítems del checklist (ej. ["[x] Crear esquema DB", "[ ] Endpoint login"]).',
        },
        notes: {
          type: 'string',
          description: 'Notas activas de la sesión, contexto técnico relevante y estado actual.',
        },
        nextSteps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista ordenada de siguientes pasos para la próxima sesión.',
        },
        status: {
          type: 'string',
          enum: ['IN_PROGRESS', 'PAUSED', 'COMPLETED', 'BLOCKED'],
          description: 'Estado de la tarea (por defecto IN_PROGRESS).',
        },
        query: {
          type: 'string',
          description: 'Término de búsqueda para encontrar una tarea al usar action="load" o action="list".',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'memory_bank',
    description: 'Lee o actualiza el Memory Bank global en Markdown (reglas persistentes del usuario, convenciones de código, stack tecnológico y preferencias).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'append', 'overwrite'],
          description: 'Acción sobre el Memory Bank.',
        },
        content: {
          type: 'string',
          description: 'Contenido a añadir o sobreescribir en el Memory Bank.',
        },
        section: {
          type: 'string',
          description: 'Sección donde añadir la nota (ej. "Reglas de Código", "Preferencias UI", "Credenciales Locales").',
        },
      },
      required: ['action'],
    },
  },
];

async function handleTaskEngineTool(name, args) {
  switch (name) {
    case 'task_session': {
      const action = args.action;

      if (action === 'create' || action === 'update') {
        if (!args.taskId && !args.title) {
          return formatTextResponse('Debes proporcionar un taskId o un title para crear o actualizar la tarea.', true);
        }

        const taskId = slugify(args.taskId || args.title);
        const taskFile = getTaskFilePath(taskId);
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

        let existingContent = '';
        let oldTask = null;
        if (fs.existsSync(taskFile)) {
          existingContent = fs.readFileSync(taskFile, 'utf-8');
          oldTask = parseTaskMarkdown(existingContent, `${taskId}.md`);
        }

        const title = args.title || (oldTask ? oldTask.title : taskId);
        const project = args.project || (oldTask ? oldTask.project : 'General');
        const status = args.status || (oldTask ? oldTask.status : 'IN_PROGRESS');
        const objective = args.objective || (oldTask ? '' : 'No especificado');

        let checklistText = '';
        if (args.checklist && args.checklist.length > 0) {
          checklistText = args.checklist
            .map((item) => {
              if (item.startsWith('- [')) return item;
              if (item.startsWith('[')) return `- ${item}`;
              return `- [ ] ${item}`;
            })
            .join('\n');
        }

        let nextStepsText = '';
        if (args.nextSteps && args.nextSteps.length > 0) {
          nextStepsText = args.nextSteps.map((step, idx) => `${idx + 1}. ${step}`).join('\n');
        }

        const mdDocument = [
          `# Tarea: ${title}`,
          `**ID**: \`${taskId}\``,
          `**Estado**: \`${status}\``,
          `**Proyecto**: \`${project}\``,
          `**Actualizado**: \`${now}\``,
          ``,
          `## 🎯 Objetivo`,
          `${objective}`,
          ``,
          `## 📋 Checklist de Ejecución`,
          `${checklistText || '- [ ] Definir requerimientos'}`,
          ``,
          `## 🧠 Contexto Activo & Notas Técnicas`,
          `${args.notes || '(Sin notas registradas en esta sesión)'}`,
          ``,
          `## ⏭️ Próximos Pasos para la Siguiente Sesión`,
          `${nextStepsText || '1. Continuar con el checklist pendiente'}`,
          ``,
          `---`,
          `*Documento de tarea gestionado dinámicamente por OpenPC-MCP Task Engine.*`,
        ].join('\n');

        fs.writeFileSync(taskFile, mdDocument, 'utf-8');

        return formatTextResponse({
          message: action === 'create' ? 'Tarea creada con éxito en Markdown' : 'Tarea actualizada con éxito',
          taskId: taskId,
          filePath: taskFile,
          status: status,
          summary: `Se ha guardado el estado de la tarea en ${taskFile}`,
        });
      }

      if (action === 'load') {
        const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.md'));
        if (files.length === 0) {
          return formatTextResponse('No hay tareas guardadas en la carpeta .tasks/. Usa action="create" para iniciar una nueva tarea.', false);
        }

        let targetFile = null;

        if (args.taskId) {
          const clean = slugify(args.taskId);
          targetFile = files.find((f) => f.includes(clean));
        }

        if (!targetFile && args.query) {
          const q = args.query.toLowerCase();
          for (const f of files) {
            const content = fs.readFileSync(path.join(tasksDir, f), 'utf-8').toLowerCase();
            if (f.toLowerCase().includes(q) || content.includes(q)) {
              targetFile = f;
              break;
            }
          }
        }

        if (!targetFile) {
          files.sort((a, b) => {
            const statA = fs.statSync(path.join(tasksDir, a));
            const statB = fs.statSync(path.join(tasksDir, b));
            return statB.mtimeMs - statA.mtimeMs;
          });
          targetFile = files[0];
        }

        const raw = fs.readFileSync(path.join(tasksDir, targetFile), 'utf-8');
        const parsed = parseTaskMarkdown(raw, targetFile);

        return formatTextResponse(
          `=== TAREA CARGADA: ${parsed.title} [ID: ${parsed.taskId}] ===\n` +
          `Archivo local: ${parsed.filePath}\n` +
          `Estado: ${parsed.status} | Proyecto: ${parsed.project} | Última actualización: ${parsed.lastUpdated}\n\n` +
          `${raw}`
        );
      }

      if (action === 'list') {
        const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.md'));
        const tasks = [];

        for (const f of files) {
          try {
            const content = fs.readFileSync(path.join(tasksDir, f), 'utf-8');
            tasks.push(parseTaskMarkdown(content, f));
          } catch (e) {}
        }

        tasks.sort((a, b) => {
          const statA = fs.statSync(a.filePath);
          const statB = fs.statSync(b.filePath);
          return statB.mtimeMs - statA.mtimeMs;
        });

        return formatTextResponse({
          totalTasks: tasks.length,
          tasksDirectory: tasksDir,
          tasks: tasks.map((t) => ({
            taskId: t.taskId,
            title: t.title,
            status: t.status,
            project: t.project,
            lastUpdated: t.lastUpdated,
            file: path.basename(t.filePath),
          })),
        });
      }

      if (action === 'archive') {
        if (!args.taskId) return formatTextResponse('taskId es requerido para archivar.', true);
        const taskFile = getTaskFilePath(slugify(args.taskId));
        if (!fs.existsSync(taskFile)) {
          return formatTextResponse(`No se encontró la tarea '${args.taskId}'.`, true);
        }

        let content = fs.readFileSync(taskFile, 'utf-8');
        content = content.replace(/\*\*Estado\*\*:\s*`?[A-Z_]+`?/i, '**Estado**: `COMPLETED`');
        fs.writeFileSync(taskFile, content, 'utf-8');

        return formatTextResponse(`Tarea '${args.taskId}' marcada como COMPLETED (Completada).`);
      }

      return formatTextResponse(`Acción '${action}' no válida para task_session.`, true);
    }

    case 'memory_bank': {
      const action = args.action;

      if (!fs.existsSync(memoryFile)) {
        const initialContent = [
          `# 🧠 OpenPC-MCP: Memory Bank Global`,
          `*Reglas persistentes, preferencias de usuario y decisiones técnicas compartidas.*`,
          ``,
          `## ⚙️ Preferencias Generales`,
          `- Idioma preferido: Español`,
          `- Editor preferido: VS Code`,
          ``,
          `## 📐 Convenciones de Código`,
          `- Código limpio, modular y documentado.`,
          ``,
        ].join('\n');
        fs.writeFileSync(memoryFile, initialContent, 'utf-8');
      }

      if (action === 'read') {
        const content = fs.readFileSync(memoryFile, 'utf-8');
        return formatTextResponse(content);
      }

      if (action === 'append') {
        if (!args.content) return formatTextResponse('content es requerido para append.', true);
        const section = args.section ? `\n\n### ${args.section}\n` : '\n\n';
        const entry = `${section}- [${new Date().toISOString().substring(0, 10)}] ${args.content}`;
        fs.appendFileSync(memoryFile, entry, 'utf-8');
        return formatTextResponse(`Nota añadida al Memory Bank en: ${memoryFile}`);
      }

      if (action === 'overwrite') {
        if (!args.content) return formatTextResponse('content es requerido para overwrite.', true);
        fs.writeFileSync(memoryFile, args.content, 'utf-8');
        return formatTextResponse(`Memory Bank actualizado con éxito en: ${memoryFile}`);
      }

      return formatTextResponse(`Acción '${action}' no reconocida para memory_bank.`, true);
    }

    default:
      return null;
  }
}

module.exports = {
  taskEngineTools,
  handleTaskEngineTool,
};
