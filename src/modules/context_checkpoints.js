const fs = require('fs');
const path = require('path');
const { formatTextResponse } = require('../utils/helpers');
const config = require('../config');

const checkpointsDir = path.join(config.dataDir, 'checkpoints');
const memoryFilePath = path.join(config.dataDir, 'long_term_memory.json');

if (!fs.existsSync(checkpointsDir)) {
  fs.mkdirSync(checkpointsDir, { recursive: true });
}

function loadMemories() {
  if (!fs.existsSync(memoryFilePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(memoryFilePath, 'utf-8'));
  } catch (e) {
    return [];
  }
}

function saveMemories(list) {
  fs.writeFileSync(memoryFilePath, JSON.stringify(list, null, 2), 'utf-8');
}

const contextCheckpointTools = [
  {
    name: 'save_context_checkpoint',
    description: 'Guarda un checkpoint completo del contexto actual (resumen de lo completado, archivos modificados, arquitectura, decisiones y próximos pasos) para que puedas reanudar el trabajo en cualquier momento o desde un nuevo chat sin perder el hilo.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título descriptivo del checkpoint (ej. "Refactor de autenticación completado", "Sprint 1 listo").' },
        project: { type: 'string', description: 'Nombre o ruta del proyecto relacionado (ej. "mi-app-web").' },
        summary: { type: 'string', description: 'Resumen detallado de lo que se ha realizado hasta este punto.' },
        modifiedFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista de rutas de archivos creados o editados en esta sesión.',
        },
        nextSteps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista ordenada de los siguientes pasos pendientes.',
        },
        metadata: {
          type: 'object',
          description: 'Cualquier información adicional útil (variables de configuración, URLs de prueba, etc.).',
        },
      },
      required: ['title', 'summary'],
    },
  },
  {
    name: 'load_context_checkpoint',
    description: 'Recupera un checkpoint de contexto guardado previamente (el más reciente o por identificador/búsqueda) para que el modelo adquiera todo el conocimiento acumulado del proyecto.',
    inputSchema: {
      type: 'object',
      properties: {
        checkpointId: {
          type: 'string',
          description: 'ID o nombre del archivo del checkpoint (opcional, si se omite carga el más reciente).',
        },
        project: {
          type: 'string',
          description: 'Filtro opcional para buscar el último checkpoint de un proyecto específico.',
        },
      },
    },
  },
  {
    name: 'list_context_checkpoints',
    description: 'Muestra la lista cronológica de todos los checkpoints guardados con sus fechas, títulos y proyectos asociados.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Número máximo de checkpoints a listar (por defecto 20).' },
      },
    },
  },
  {
    name: 'store_memory',
    description: 'Guarda una nota, preferencia del usuario o decisión técnica en la memoria persistente a largo plazo del PC.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Clave o concepto principal (ej. "preferencia_css", "puerto_backend", "convencion_commits").' },
        value: { type: 'string', description: 'El contenido o regla a recordar permanentemente.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Etiquetas para categorizar (ej. ["estilo", "react", "usuario"]).',
        },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'recall_memory',
    description: 'Consulta o busca recuerdos, preferencias y decisiones almacenadas en la memoria persistente a largo plazo.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Término de búsqueda o etiqueta para filtrar memorias (opcional).' },
      },
    },
  },
];

async function handleContextCheckpointTool(name, args) {
  switch (name) {
    case 'save_context_checkpoint': {
      const now = new Date();
      const id = `checkpoint_${now.toISOString().replace(/[:.]/g, '-')}`;
      const filename = `${id}.json`;
      const fullPath = path.join(checkpointsDir, filename);

      const data = {
        id: id,
        timestamp: now.toISOString(),
        title: args.title,
        project: args.project || 'default',
        summary: args.summary,
        modifiedFiles: args.modifiedFiles || [],
        nextSteps: args.nextSteps || [],
        metadata: args.metadata || {},
      };

      fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf-8');

      return formatTextResponse({
        message: 'Checkpoint de contexto guardado con éxito',
        checkpointId: id,
        file: fullPath,
        timestamp: data.timestamp,
        title: data.title,
      });
    }

    case 'load_context_checkpoint': {
      const files = fs.readdirSync(checkpointsDir).filter((f) => f.endsWith('.json'));
      if (files.length === 0) {
        return formatTextResponse('No hay checkpoints guardados todavía en este PC.', false);
      }

      let targetFile = null;

      if (args.checkpointId) {
        targetFile = files.find((f) => f.includes(args.checkpointId));
        if (!targetFile) {
          return formatTextResponse(`No se encontró ningún checkpoint con ID '${args.checkpointId}'`, true);
        }
      } else {
        // Ordenar por fecha descendente (los nombres tienen ISO timestamp)
        files.sort().reverse();

        if (args.project) {
          for (const f of files) {
            try {
              const parsed = JSON.parse(fs.readFileSync(path.join(checkpointsDir, f), 'utf-8'));
              if (parsed.project && parsed.project.toLowerCase().includes(args.project.toLowerCase())) {
                targetFile = f;
                break;
              }
            } catch (e) {}
          }
          if (!targetFile) targetFile = files[0]; // fallback al último global
        } else {
          targetFile = files[0];
        }
      }

      const content = JSON.parse(fs.readFileSync(path.join(checkpointsDir, targetFile), 'utf-8'));
      return formatTextResponse(content);
    }

    case 'list_context_checkpoints': {
      const files = fs.readdirSync(checkpointsDir).filter((f) => f.endsWith('.json'));
      files.sort().reverse();
      const limit = args.limit || 20;

      const list = [];
      for (const f of files.slice(0, limit)) {
        try {
          const item = JSON.parse(fs.readFileSync(path.join(checkpointsDir, f), 'utf-8'));
          list.push({
            checkpointId: item.id,
            timestamp: item.timestamp,
            title: item.title,
            project: item.project,
            modifiedFilesCount: (item.modifiedFiles || []).length,
            nextStepsCount: (item.nextSteps || []).length,
          });
        } catch (e) {}
      }

      return formatTextResponse({
        totalCheckpoints: files.length,
        returned: list.length,
        checkpoints: list,
      });
    }

    case 'store_memory': {
      const memories = loadMemories();
      const existingIdx = memories.findIndex((m) => m.key.toLowerCase() === args.key.toLowerCase());

      const item = {
        key: args.key,
        value: args.value,
        tags: args.tags || [],
        updatedAt: new Date().toISOString(),
      };

      if (existingIdx >= 0) {
        memories[existingIdx] = item;
      } else {
        memories.push(item);
      }

      saveMemories(memories);
      return formatTextResponse(`Memoria persistente guardada para la clave '${args.key}'.`);
    }

    case 'recall_memory': {
      const memories = loadMemories();
      const q = args.query ? args.query.toLowerCase() : null;

      const filtered = q
        ? memories.filter(
            (m) =>
              m.key.toLowerCase().includes(q) ||
              m.value.toLowerCase().includes(q) ||
              (m.tags && m.tags.some((t) => t.toLowerCase().includes(q)))
          )
        : memories;

      return formatTextResponse({
        totalMemories: memories.length,
        matched: filtered.length,
        memories: filtered,
      });
    }

    default:
      return null;
  }
}

module.exports = {
  contextCheckpointTools,
  handleContextCheckpointTool,
};
