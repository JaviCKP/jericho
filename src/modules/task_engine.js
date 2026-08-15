const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { formatTextResponse, truncateString } = require('../utils/helpers');
const config = require('../config');

const tasksDir = path.join(config.workspaceDir, '.tasks');
const memoryBankDir = path.join(config.workspaceDir, '.context');

// Asegurar directorios
if (!fs.existsSync(tasksDir)) fs.mkdirSync(tasksDir, { recursive: true });
if (!fs.existsSync(memoryBankDir)) fs.mkdirSync(memoryBankDir, { recursive: true });

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

function parseTaskMarkdown(content, filename) {
  const lines = content.split(/\r?\n/);
  let title = filename.replace('.md', '');
  let status = 'OPEN';
  let project = 'General';
  let lastUpdated = '';
  const checklist = [];
  const relevantFiles = [];

  let inChecklist = false;
  let inFiles = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('# Tarea:') || line.startsWith('# Task:')) {
      title = line.replace(/# (Tarea|Task):/, '').trim();
    }
    const statusMatch = line.match(/\*\*Estado\*\*:\s*`?([A-Z_]+)`?/i) || line.match(/\*\*Status\*\*:\s*`?([A-Z_]+)`?/i);
    if (statusMatch) status = statusMatch[1].toUpperCase();

    const projMatch = line.match(/\*\*Proyecto\*\*:\s*`?([^`\n\r]+)`?/i) || line.match(/\*\*Project\*\*:\s*`?([^`\n\r]+)`?/i);
    if (projMatch) project = projMatch[1].trim();

    const dateMatch = line.match(/\*\*Actualizado\*\*:\s*`?([^`\n\r]+)`?/i) || line.match(/\*\*Updated\*\*:\s*`?([^`\n\r]+)`?/i);
    if (dateMatch) lastUpdated = dateMatch[1].trim();

    if (line.startsWith('## 📋 Checklist') || line.startsWith('## Checklist')) {
      inChecklist = true;
      inFiles = false;
      continue;
    }
    if (line.startsWith('## 📁 Archivos Relevantes') || line.startsWith('## Relevant Files')) {
      inFiles = true;
      inChecklist = false;
      continue;
    }
    if (line.startsWith('## ')) {
      inChecklist = false;
      inFiles = false;
    }

    if (inChecklist && line.trim().startsWith('- [')) {
      const isDone = line.includes('- [x]') || line.includes('- [X]');
      checklist.push({
        text: line.replace(/- \[[ xX]\]/, '').trim(),
        completed: isDone,
      });
    }

    if (inFiles && line.trim().startsWith('- `')) {
      const fileMatch = line.match(/- `([^`]+)`/);
      if (fileMatch) relevantFiles.push(fileMatch[1]);
    }
  }

  const completedCount = checklist.filter((c) => c.completed).length;
  const totalCount = checklist.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return {
    taskId: filename.replace('.md', ''),
    title: title,
    status: status,
    project: project,
    lastUpdated: lastUpdated,
    totalChecklist: totalCount,
    completedChecklist: completedCount,
    progressPercent: `${progressPercent}%`,
    relevantFiles: relevantFiles,
    filePath: path.join(tasksDir, filename),
    rawContent: content,
  };
}

const taskEngineTools = [
  {
    name: 'list_pending_tasks',
    description: 'Lista todas las tareas y sesiones de trabajo almacenadas en el sistema (.tasks/) mostrando su estado, porcentaje de avance, fecha de actualización y resumen para saber en qué punto se quedó cada proyecto.',
    inputSchema: {
      type: 'object',
      properties: {
        statusFilter: {
          type: 'string',
          enum: ['ALL', 'IN_PROGRESS', 'PAUSED', 'COMPLETED'],
          description: 'Filtro por estado (por defecto ALL o IN_PROGRESS).',
        },
        project: {
          type: 'string',
          description: 'Filtro opcional por nombre de proyecto o carpeta.',
        },
      },
    },
  },
  {
    name: 'resume_task_session',
    description: 'Carga el contexto completo de una tarea específica para continuar programando o trabajando en ella. Devuelve el objetivo, checklist, decisiones técnicas, estado de Git y lee automáticamente los archivos de código clave vinculados a la tarea para que el modelo tenga contexto inmediato.',
    inputSchema: {
      type: 'object',
      properties: {
        taskIdOrQuery: {
          type: 'string',
          description: 'Identificador exacto o palabra clave de la tarea (ej. "auth-jwt", "landing", "stripe"). Si se omite, carga la última tarea modificada.',
        },
        includeFilePreviews: {
          type: 'boolean',
          description: 'Si es true (por defecto true), lee y adjunta un extracto de los archivos relevantes listados en la tarea.',
        },
      },
    },
  },
  {
    name: 'save_or_update_task',
    description: 'Crea o actualiza el documento Markdown de una tarea en el sistema (.tasks/). Permite modificar el checklist de progreso, registrar archivos modificados, notas de arquitectura y definir los próximos pasos a realizar.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'ID único o nombre en slug de la tarea (ej. "auth-jwt", "migracion-db").',
        },
        title: {
          type: 'string',
          description: 'Título descriptivo de la tarea.',
        },
        project: {
          type: 'string',
          description: 'Ruta o nombre del proyecto (ej. "C:\\Users\\javi\\ChatGPT-Workspace\\mi-app").',
        },
        objective: {
          type: 'string',
          description: 'Objetivo principal y criterios de aceptación de la tarea.',
        },
        relevantFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista de archivos clave involucrados en esta tarea (ej. ["src/auth.js", "backend/server.py"]).',
        },
        checklist: {
          type: 'array',
          items: { type: 'string' },
          description: 'Checklist de pasos. Usa "[x] ..." para completados y "[ ] ..." para pendientes.',
        },
        activeNotes: {
          type: 'string',
          description: 'Contexto activo de la sesión: decisiones tomadas, problemas encontrados y estado actual del código.',
        },
        nextSteps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista ordenada de los siguientes pasos específicos para la próxima sesión.',
        },
        status: {
          type: 'string',
          enum: ['IN_PROGRESS', 'PAUSED', 'COMPLETED', 'BLOCKED'],
          description: 'Estado actual de la tarea.',
        },
      },
      required: ['taskId', 'title'],
    },
  },
  {
    name: 'memory_bank',
    description: 'Consulta o actualiza el Memory Bank del proyecto (.context/): patrones de diseño, reglas de codificación, contexto tecnológico y decisiones permanentes.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read_all', 'get_section', 'append_rule', 'update_section'],
          description: 'Acción a realizar sobre el Memory Bank.',
        },
        section: {
          type: 'string',
          description: 'Nombre de la sección o archivo (ej. "systemPatterns", "techContext", "codingRules").',
        },
        content: {
          type: 'string',
          description: 'Contenido a añadir o actualizar.',
        },
      },
      required: ['action'],
    },
  },
];

async function handleTaskEngineTool(name, args) {
  switch (name) {
    case 'list_pending_tasks': {
      const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.md'));
      if (files.length === 0) {
        return formatTextResponse({
          totalTasks: 0,
          message: 'No hay tareas guardadas en .tasks/. Puedes crear una usando save_or_update_task.',
          tasks: [],
        });
      }

      const tasks = [];
      for (const f of files) {
        try {
          const content = fs.readFileSync(path.join(tasksDir, f), 'utf-8');
          tasks.push(parseTaskMarkdown(content, f));
        } catch (e) {}
      }

      // Ordenar por última modificación descendente
      tasks.sort((a, b) => {
        const statA = fs.statSync(a.filePath);
        const statB = fs.statSync(b.filePath);
        return statB.mtimeMs - statA.mtimeMs;
      });

      let filtered = tasks;
      if (args && args.statusFilter && args.statusFilter !== 'ALL') {
        filtered = filtered.filter((t) => t.status === args.statusFilter);
      }
      if (args && args.project) {
        const pLow = args.project.toLowerCase();
        filtered = filtered.filter((t) => t.project.toLowerCase().includes(pLow));
      }

      let summaryTable = `=== 📋 SESIONES Y TAREAS EN EL SISTEMA (${filtered.length} tareas) ===\n\n`;
      filtered.forEach((t, i) => {
        summaryTable += `${i + 1}. [${t.status}] **${t.title}** (ID: \`${t.taskId}\`)\n`;
        summaryTable += `   📁 Proyecto: ${t.project} | 📈 Progreso: ${t.progressPercent} (${t.completedChecklist}/${t.totalChecklist}) | 🕒 Actualizado: ${t.lastUpdated}\n`;
        if (t.relevantFiles.length > 0) {
          summaryTable += `   📄 Archivos clave: ${t.relevantFiles.join(', ')}\n`;
        }
        summaryTable += `\n`;
      });

      summaryTable += `👉 Para reanudar una tarea, ejecuta: resume_task_session(taskIdOrQuery="<id_o_nombre>")`;

      return formatTextResponse(summaryTable);
    }

    case 'resume_task_session': {
      const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.md'));
      if (files.length === 0) {
        return formatTextResponse('No se encontraron tareas en .tasks/. Usa save_or_update_task para crear la primera tarea.', true);
      }

      let targetFile = null;
      const query = args && args.taskIdOrQuery ? args.taskIdOrQuery.toLowerCase().trim() : null;

      if (query) {
        const slug = slugify(query);
        targetFile = files.find((f) => f.toLowerCase().replace('.md', '') === slug);

        if (!targetFile) {
          // Búsqueda difusa en nombres y contenido
          for (const f of files) {
            const content = fs.readFileSync(path.join(tasksDir, f), 'utf-8').toLowerCase();
            if (f.toLowerCase().includes(query) || content.includes(query)) {
              targetFile = f;
              break;
            }
          }
        }
      }

      if (!targetFile) {
        // Cargar la más recientemente editada
        files.sort((a, b) => {
          const statA = fs.statSync(path.join(tasksDir, a));
          const statB = fs.statSync(path.join(tasksDir, b));
          return statB.mtimeMs - statA.mtimeMs;
        });
        targetFile = files[0];
      }

      const raw = fs.readFileSync(path.join(tasksDir, targetFile), 'utf-8');
      const parsed = parseTaskMarkdown(raw, targetFile);

      let contextBriefing = `=================================================================\n`;
      contextBriefing += `🎯 RESUMEN DE CONTEXTO CARGADO: ${parsed.title}\n`;
      contextBriefing += `=================================================================\n`;
      contextBriefing += `ID Tarea: ${parsed.taskId} | Estado: ${parsed.status} | Progreso: ${parsed.progressPercent}\n`;
      contextBriefing += `Proyecto Base: ${parsed.project}\n`;
      contextBriefing += `Última Actualización: ${parsed.lastUpdated}\n\n`;
      contextBriefing += `--- CONTENIDO DE LA TAREA (MARKDOWN) ---\n${raw}\n\n`;

      // 1. Estado de Git si el proyecto es un repo
      if (parsed.project && fs.existsSync(parsed.project)) {
        try {
          const gitBranch = execSync('git branch --show-current', { cwd: parsed.project, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
          const gitStatus = execSync('git status --short', { cwd: parsed.project, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
          contextBriefing += `--- ESTADO DE GIT EN EL PROYECTO ---\n`;
          contextBriefing += `Rama actual: ${gitBranch || 'main'}\n`;
          contextBriefing += `Archivos modificados sin commit:\n${gitStatus || '(Árbol limpio)'}\n\n`;
        } catch (e) {}
      }

      // 2. Previsualización de archivos relevantes si están configurados
      const includePreviews = args ? args.includeFilePreviews !== false : true;
      if (includePreviews && parsed.relevantFiles.length > 0) {
        contextBriefing += `--- EXTRACTO DE ARCHIVOS CLAVE DEL PROYECTO ---\n`;
        for (const relFile of parsed.relevantFiles.slice(0, 4)) {
          const fullFilePath = path.isAbsolute(relFile)
            ? relFile
            : path.resolve(parsed.project || config.workspaceDir, relFile);

          if (fs.existsSync(fullFilePath)) {
            try {
              const fileContent = fs.readFileSync(fullFilePath, 'utf-8');
              const lines = fileContent.split(/\r?\n/);
              const preview = lines.slice(0, 50).join('\n');
              contextBriefing += `\n📄 Archivo: ${relFile} (${lines.length} líneas totales):\n\`\`\`\n${preview}\n\`\`\`\n`;
            } catch (e) {}
          }
        }
      }

      return formatTextResponse(truncateString(contextBriefing, config.maxOutputChars));
    }

    case 'save_or_update_task': {
      const taskId = slugify(args.taskId || args.title);
      const taskFile = path.join(tasksDir, `${taskId}.md`);
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

      let oldTask = null;
      if (fs.existsSync(taskFile)) {
        const oldContent = fs.readFileSync(taskFile, 'utf-8');
        oldTask = parseTaskMarkdown(oldContent, `${taskId}.md`);
      }

      const title = args.title || (oldTask ? oldTask.title : taskId);
      const project = args.project || (oldTask ? oldTask.project : config.workspaceDir);
      const status = args.status || (oldTask ? oldTask.status : 'IN_PROGRESS');
      const objective = args.objective || (oldTask ? '' : 'No especificado');

      let relevantFilesText = '';
      if (args.relevantFiles && args.relevantFiles.length > 0) {
        relevantFilesText = args.relevantFiles.map((f) => `- \`${f}\``).join('\n');
      } else if (oldTask && oldTask.relevantFiles.length > 0) {
        relevantFilesText = oldTask.relevantFiles.map((f) => `- \`${f}\``).join('\n');
      }

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
        `## 🎯 Objetivo & Criterios de Aceptación`,
        `${objective}`,
        ``,
        `## 📁 Archivos Relevantes`,
        `${relevantFilesText || '- (No se han asignado archivos específicos)'}`,
        ``,
        `## 📋 Checklist de Ejecución`,
        `${checklistText || '- [ ] Definir requerimientos iniciales'}`,
        ``,
        `## 🧠 Contexto Activo & Notas de Arquitectura`,
        `${args.activeNotes || '(Sin notas registradas en esta sesión)'}`,
        ``,
        `## ⏭️ Próximos Pasos para la Siguiente Sesión`,
        `${nextStepsText || '1. Continuar con el checklist pendiente'}`,
        ``,
        `---`,
        `*Documento de tarea gestionado por OpenPC-MCP Task Engine.*`,
      ].join('\n');

      fs.writeFileSync(taskFile, mdDocument, 'utf-8');

      return formatTextResponse({
        message: 'Tarea y contexto guardados con éxito en Markdown',
        taskId: taskId,
        filePath: taskFile,
        status: status,
        project: project,
      });
    }

    case 'memory_bank': {
      const action = args.action;
      const memBankFile = path.join(memoryBankDir, 'MEMORY_BANK.md');

      if (!fs.existsSync(memBankFile)) {
        const initialContent = [
          `# 🧠 OpenPC-MCP: Project Memory Bank`,
          `*Reglas de ingeniería, patrones de diseño y decisiones arquitectónicas globales.*`,
          ``,
          `## 📐 Reglas de Codificación`,
          `- Escribir código modular, tipado y bien testeado.`,
          `- Usar async/await y manejo robusto de excepciones.`,
          ``,
          `## ⚙️ Stack y Preferencias`,
          `- Entorno: Node.js / PowerShell / Windows`,
          `- Estilos: TailwindCSS / Vanilla CSS`,
          ``,
        ].join('\n');
        fs.writeFileSync(memBankFile, initialContent, 'utf-8');
      }

      if (action === 'read_all') {
        const content = fs.readFileSync(memBankFile, 'utf-8');
        return formatTextResponse(content);
      }

      if (action === 'append_rule') {
        if (!args.content) return formatTextResponse('content es requerido para append_rule.', true);
        const sectionHeader = args.section ? `\n\n### ${args.section}\n` : '\n\n';
        const entry = `${sectionHeader}- [${new Date().toISOString().substring(0, 10)}] ${args.content}`;
        fs.appendFileSync(memBankFile, entry, 'utf-8');
        return formatTextResponse(`Regla añadida al Memory Bank: ${memBankFile}`);
      }

      if (action === 'update_section' || action === 'overwrite') {
        if (!args.content) return formatTextResponse('content es requerido.', true);
        fs.writeFileSync(memBankFile, args.content, 'utf-8');
        return formatTextResponse(`Memory Bank actualizado en: ${memBankFile}`);
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
