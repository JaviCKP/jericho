const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { formatTextResponse, truncateString } = require('../utils/helpers');
const config = require('../config');

// Directorio raíz de tareas y contextos modulares
const tasksRootDir = path.join(config.workspaceDir, '.tasks');
const contextDir = path.join(config.workspaceDir, '.context');

if (!fs.existsSync(tasksRootDir)) fs.mkdirSync(tasksRootDir, { recursive: true });
if (!fs.existsSync(contextDir)) fs.mkdirSync(contextDir, { recursive: true });

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

/**
 * Escanea recursivamente todas las hojas de contexto (.md) organizadas por proyecto
 */
function scanAllTaskFiles(dir = tasksRootDir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(scanAllTaskFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

function parseTaskMarkdown(content, fullFilePath) {
  const lines = content.split(/\r?\n/);
  const relPath = path.relative(tasksRootDir, fullFilePath);
  const pathParts = relPath.split(path.sep);
  const projectFromFolder = pathParts.length > 1 ? pathParts[0] : 'General';
  const filename = path.basename(fullFilePath);

  let title = filename.replace('.md', '');
  let status = 'OPEN';
  let project = projectFromFolder;
  let lastUpdated = '';
  let sheetType = 'task'; // 'task', 'architecture', 'decisions', 'notes'
  const checklist = [];
  const relevantFiles = [];

  if (filename.toLowerCase().includes('architecture') || filename.toLowerCase().includes('arquitectura')) {
    sheetType = 'architecture';
  } else if (filename.toLowerCase().includes('decision')) {
    sheetType = 'decisions';
  }

  let inChecklist = false;
  let inFiles = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('# Tarea:') || line.startsWith('# Task:') || line.startsWith('# ')) {
      if (!title || title === filename.replace('.md', '')) {
        title = line.replace(/# (Tarea:|Task:)?/, '').trim();
      }
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
    sheetType: sheetType,
    title: title,
    status: status,
    project: project,
    relativeFilePath: relPath,
    lastUpdated: lastUpdated,
    totalChecklist: totalCount,
    completedChecklist: completedCount,
    progressPercent: `${progressPercent}%`,
    relevantFiles: relevantFiles,
    filePath: fullFilePath,
    rawContent: content,
  };
}

const AGENT_SYSTEM_PROTOCOL = `
# 🤖 PROTOCOLO DE AUTONOMÍA DEL AGENTE OPENPC-MCP

Como agente de software con acceso a este ordenador, DEBES seguir estas 3 directrices en cada conversación:

1. 🚀 AL INICIAR LA CONVERSACIÓN:
   - Si el usuario menciona una tarea o proyecto, ejecuta 'resume_task_session' para cargar la hoja de contexto correspondiente y ubicarte inmediatamente en el código, estado de Git y siguientes pasos.
   - Si el usuario pregunta "¿qué teníamos pendiente?", ejecuta 'list_pending_tasks' para presentarle las tareas organizadas por carpetas de proyecto.

2. 💻 DURANTE EL DESARROLLO:
   - Utiliza 'edit_file_replace' para ediciones de código limpias sin romper archivos.
   - Ejecuta 'run_command' para compilar, instalar o correr tests.
   - Si inicias un servidor web o dev server, usa 'run_background_command' y verifica que el puerto esté abierto.
   - Si realizas cambios visuales, usa 'take_screenshot' para verificar la interfaz.

3. 📝 AL CONCLUIR O AL AVANZAR EN UN HITO (OBLIGATORIO):
   - NUNCA cierres la sesión sin actualizar la hoja de contexto con 'save_or_update_task'.
   - Marca los pasos completados [x], registra las decisiones técnicas tomadas y redacta con claridad los próximos pasos pendientes. Esto garantiza que cualquier chat futuro retome el trabajo con cero pérdida de memoria.
`.trim();

const taskEngineTools = [
  {
    name: 'get_agent_protocol',
    description: 'Obtiene las directrices y protocolo de operación del agente para mantener el contexto siempre sincronizado, gestionar hojas modulares y no perder nunca el estado de trabajo.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_pending_tasks',
    description: 'Lista todas las hojas de contexto y tareas organizadas por carpetas de proyecto en .tasks/ con su porcentaje de avance, estado y archivos vinculados.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Filtro opcional para listar solo las hojas de contexto de un proyecto específico (ej. "tienda-online", "api-backend").',
        },
        statusFilter: {
          type: 'string',
          enum: ['ALL', 'IN_PROGRESS', 'PAUSED', 'COMPLETED'],
          description: 'Filtro por estado de tarea (por defecto ALL).',
        },
      },
    },
  },
  {
    name: 'resume_task_session',
    description: 'Carga el contexto completo de una tarea u hoja modular de un proyecto (objetivo, checklist, Git, arquitectura) y previsualiza automáticamente los archivos de código vinculados para ubicarse al instante.',
    inputSchema: {
      type: 'object',
      properties: {
        taskIdOrQuery: {
          type: 'string',
          description: 'Nombre de la tarea, ID o término de búsqueda (ej. "auth-jwt", "stripe", "landing").',
        },
        project: {
          type: 'string',
          description: 'Carpeta o nombre del proyecto (opcional para desambiguar entre proyectos).',
        },
        includeFilePreviews: {
          type: 'boolean',
          description: 'Si es true (por defecto true), lee y adjunta fragmentos de los archivos clave.',
        },
      },
    },
  },
  {
    name: 'save_or_update_task',
    description: 'Crea o actualiza una hoja de contexto modular en Markdown dentro de la carpeta del proyecto (.tasks/<proyecto>/<tarea>.md). Permite mantener el contexto dividido en hojas cortas y ordenadas por tema sin saturar un único archivo.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Identificador único o slug de la hoja de contexto (ej. "01-autenticacion", "02-base-de-datos").',
        },
        project: {
          type: 'string',
          description: 'Nombre de la carpeta del proyecto (ej. "mi-tienda-web", "backend-api"). Se creará una subcarpeta dedicada en .tasks/<project>/.',
        },
        title: {
          type: 'string',
          description: 'Título descriptivo de esta hoja de contexto.',
        },
        objective: {
          type: 'string',
          description: 'Objetivo y alcance de esta hoja modular.',
        },
        relevantFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Archivos clave del proyecto vinculados a esta hoja de contexto.',
        },
        checklist: {
          type: 'array',
          items: { type: 'string' },
          description: 'Checklist de pasos. Usa "[x] ..." para completados y "[ ] ..." para pendientes.',
        },
        activeNotes: {
          type: 'string',
          description: 'Notas técnicas, decisiones arquitectónicas y estado del código en esta sesión.',
        },
        nextSteps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista ordenada de próximos pasos para la siguiente sesión.',
        },
        status: {
          type: 'string',
          enum: ['IN_PROGRESS', 'PAUSED', 'COMPLETED', 'BLOCKED'],
          description: 'Estado de la tarea.',
        },
      },
      required: ['taskId', 'title'],
    },
  },
  {
    name: 'memory_bank',
    description: 'Consulta o actualiza el Memory Bank global (.context/): arquitectura general, patrones de diseño y decisiones transversales.',
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
          description: 'Sección (ej. "systemPatterns", "techContext", "codingRules").',
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
    case 'get_agent_protocol': {
      return formatTextResponse(AGENT_SYSTEM_PROTOCOL);
    }

    case 'list_pending_tasks': {
      const allFiles = scanAllTaskFiles();
      if (allFiles.length === 0) {
        return formatTextResponse({
          totalTasks: 0,
          message: 'No hay hojas de contexto creadas en .tasks/. Usa save_or_update_task para crear una nueva.',
          tasks: [],
        });
      }

      const tasks = allFiles.map((f) => {
        try {
          return parseTaskMarkdown(fs.readFileSync(f, 'utf-8'), f);
        } catch (e) {
          return null;
        }
      }).filter(Boolean);

      // Agrupar por proyecto
      const projectsMap = new Map();
      for (const t of tasks) {
        if (args && args.statusFilter && args.statusFilter !== 'ALL' && t.status !== args.statusFilter) {
          continue;
        }
        if (args && args.project && !t.project.toLowerCase().includes(args.project.toLowerCase())) {
          continue;
        }

        if (!projectsMap.has(t.project)) {
          projectsMap.set(t.project, []);
        }
        projectsMap.get(t.project).push(t);
      }

      let summaryTable = `=== 📁 HOJAS DE CONTEXTO POR PROYECTO (${tasks.length} hojas totales) ===\n\n`;

      for (const [projName, projTasks] of projectsMap.entries()) {
        summaryTable += `📦 **PROYECTO: ${projName}** (Carpeta: \`.tasks/${projName}/\`)\n`;
        projTasks.forEach((t, idx) => {
          summaryTable += `   ${idx + 1}. [${t.status}] **${t.title}** (ID: \`${t.taskId}\`)\n`;
          summaryTable += `      📊 Progreso: ${t.progressPercent} (${t.completedChecklist}/${t.totalChecklist}) | 🕒 Actualizado: ${t.lastUpdated}\n`;
          if (t.relevantFiles.length > 0) {
            summaryTable += `      📄 Archivos: ${t.relevantFiles.join(', ')}\n`;
          }
        });
        summaryTable += `\n`;
      }

      summaryTable += `👉 Para cargar una hoja de contexto, ejecuta: resume_task_session(taskIdOrQuery="<id_o_nombre>", project="<proyecto>")`;

      return formatTextResponse(summaryTable);
    }

    case 'resume_task_session': {
      const allFiles = scanAllTaskFiles();
      if (allFiles.length === 0) {
        return formatTextResponse('No se encontraron hojas de contexto en .tasks/. Usa save_or_update_task para crear la primera.', true);
      }

      let targetFile = null;
      const query = args && args.taskIdOrQuery ? args.taskIdOrQuery.toLowerCase().trim() : null;
      const projectFilter = args && args.project ? args.project.toLowerCase().trim() : null;

      if (query) {
        const slug = slugify(query);
        targetFile = allFiles.find((f) => {
          const base = path.basename(f, '.md').toLowerCase();
          const matchSlug = base === slug || base.includes(slug);
          if (projectFilter) {
            return matchSlug && f.toLowerCase().includes(projectFilter);
          }
          return matchSlug;
        });

        if (!targetFile) {
          // Búsqueda en contenido
          for (const f of allFiles) {
            if (projectFilter && !f.toLowerCase().includes(projectFilter)) continue;
            const content = fs.readFileSync(f, 'utf-8').toLowerCase();
            if (content.includes(query)) {
              targetFile = f;
              break;
            }
          }
        }
      }

      if (!targetFile) {
        // Ordenar por última modificación descendente
        allFiles.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        targetFile = allFiles[0];
      }

      const raw = fs.readFileSync(targetFile, 'utf-8');
      const parsed = parseTaskMarkdown(raw, targetFile);

      let contextBriefing = `=================================================================\n`;
      contextBriefing += `🎯 HOJA DE CONTEXTO ACTIVA: ${parsed.title}\n`;
      contextBriefing += `=================================================================\n`;
      contextBriefing += `ID: ${parsed.taskId} | Proyecto: ${parsed.project} | Estado: ${parsed.status} | Progreso: ${parsed.progressPercent}\n`;
      contextBriefing += `Ubicación en disco: ${parsed.filePath}\n`;
      contextBriefing += `Última Actualización: ${parsed.lastUpdated}\n\n`;
      contextBriefing += `--- CONTENIDO DE LA HOJA DE CONTEXTO ---\n${raw}\n\n`;

      // 1. Estado de Git si el proyecto es un repo
      const projectPath = path.resolve(config.workspaceDir, parsed.project);
      const repoCheckPath = fs.existsSync(projectPath) ? projectPath : config.workspaceDir;

      try {
        const gitBranch = execSync('git branch --show-current', { cwd: repoCheckPath, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        const gitStatus = execSync('git status --short', { cwd: repoCheckPath, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        if (gitBranch || gitStatus) {
          contextBriefing += `--- ESTADO DE GIT EN EL PROYECTO (${repoCheckPath}) ---\n`;
          contextBriefing += `Rama: ${gitBranch || 'main'}\n`;
          contextBriefing += `Cambios pendientes:\n${gitStatus || '(Árbol de trabajo limpio)'}\n\n`;
        }
      } catch (e) {}

      // 2. Previsualización de archivos relevantes
      const includePreviews = args ? args.includeFilePreviews !== false : true;
      if (includePreviews && parsed.relevantFiles.length > 0) {
        contextBriefing += `--- ARCHIVOS CLAVE ASOCIADOS A ESTA HOJA ---\n`;
        for (const relFile of parsed.relevantFiles.slice(0, 4)) {
          const fullFilePath = path.isAbsolute(relFile)
            ? relFile
            : path.resolve(repoCheckPath, relFile);

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
      const projectName = slugify(args.project || 'General');
      const taskId = slugify(args.taskId || args.title);
      const projectFolder = path.join(tasksRootDir, projectName);

      if (!fs.existsSync(projectFolder)) {
        fs.mkdirSync(projectFolder, { recursive: true });
      }

      const taskFile = path.join(projectFolder, `${taskId}.md`);
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

      let oldTask = null;
      if (fs.existsSync(taskFile)) {
        const oldContent = fs.readFileSync(taskFile, 'utf-8');
        oldTask = parseTaskMarkdown(oldContent, taskFile);
      }

      const title = args.title || (oldTask ? oldTask.title : taskId);
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
        `**Proyecto**: \`${projectName}\``,
        `**Actualizado**: \`${now}\``,
        ``,
        `## 🎯 Objetivo & Alcance`,
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
        `*Hoja de contexto gestionada por OpenPC-MCP Task Engine.*`,
      ].join('\n');

      fs.writeFileSync(taskFile, mdDocument, 'utf-8');

      return formatTextResponse({
        message: 'Hoja de contexto guardada con éxito en la carpeta del proyecto',
        taskId: taskId,
        project: projectName,
        filePath: taskFile,
        status: status,
      });
    }

    case 'memory_bank': {
      const action = args.action;
      const memBankFile = path.join(contextDir, 'MEMORY_BANK.md');

      if (!fs.existsSync(memBankFile)) {
        const initialContent = [
          `# 🧠 OpenPC-MCP: Global Memory Bank`,
          `*Reglas de ingeniería, patrones de diseño y decisiones arquitectónicas transversales.*`,
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
