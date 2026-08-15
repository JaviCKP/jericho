const { exec } = require('child_process');
const path = require('path');
const { formatTextResponse, truncateString } = require('../utils/helpers');
const config = require('../config');

function execGit(command, cwd) {
  return new Promise((resolve, reject) => {
    exec(`git ${command}`, { cwd: cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ output: stderr || stdout || err.message, isError: true });
      } else {
        resolve({ output: stdout.trim(), isError: false });
      }
    });
  });
}

const gitDevTools = [
  {
    name: 'git_status',
    description: 'Obtiene el estado completo de Git en el repositorio (rama activa, archivos modificados, staged, unstaged y commits pendientes).',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Ruta del repositorio (por defecto el directorio de trabajo).' },
      },
    },
  },
  {
    name: 'git_diff',
    description: 'Muestra las diferencias (diff) de los archivos modificados en formato unificado.',
    inputSchema: {
      type: 'object',
      properties: {
        staged: { type: 'boolean', description: 'Si es true, muestra los cambios que ya están en stage (--cached).' },
        filePath: { type: 'string', description: 'Ruta de un archivo específico para ver su diff (opcional).' },
        cwd: { type: 'string', description: 'Ruta del repositorio.' },
      },
    },
  },
  {
    name: 'git_log',
    description: 'Muestra el historial reciente de commits con autor, fecha, hash y mensaje.',
    inputSchema: {
      type: 'object',
      properties: {
        maxCommits: { type: 'number', description: 'Número máximo de commits a mostrar (por defecto 15).' },
        cwd: { type: 'string', description: 'Ruta del repositorio.' },
      },
    },
  },
  {
    name: 'git_commit',
    description: 'Añade archivos al stage y realiza un commit con un mensaje descriptivo.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Mensaje descriptivo del commit.' },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista de archivos a añadir (si se omite, se añaden todos con "git add -A").',
        },
        cwd: { type: 'string', description: 'Ruta del repositorio.' },
      },
      required: ['message'],
    },
  },
  {
    name: 'git_branch',
    description: 'Gestiona ramas de Git: listar ramas, crear una nueva rama o cambiar de rama (checkout/switch).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'switch'],
          description: 'Acción a realizar: list (listar), create (crear nueva), switch (cambiar de rama).',
        },
        branchName: { type: 'string', description: 'Nombre de la rama (requerido para create y switch).' },
        cwd: { type: 'string', description: 'Ruta del repositorio.' },
      },
      required: ['action'],
    },
  },
];

async function handleGitDevTool(name, args) {
  const cwd = args.cwd ? path.resolve(args.cwd) : config.workspaceDir;

  switch (name) {
    case 'git_status': {
      const branchRes = await execGit('branch --show-current', cwd);
      const statusRes = await execGit('status --short', cwd);

      if (statusRes.isError && statusRes.output.includes('not a git repository')) {
        return formatTextResponse(`El directorio '${cwd}' no es un repositorio Git.`, true);
      }

      const branch = branchRes.output || 'HEAD desacoplado / main';
      return formatTextResponse(
        `=== REPOSITORIO GIT: ${cwd} ===\nRama actual: ${branch}\n\n=== ESTADO DE ARCHIVOS ===\n${statusRes.output || '(Árbol de trabajo limpio, sin cambios pendientes)'}`
      );
    }

    case 'git_diff': {
      const stagedFlag = args.staged ? '--cached' : '';
      const fileArg = args.filePath ? `"${args.filePath}"` : '';
      const diffRes = await execGit(`diff ${stagedFlag} ${fileArg}`, cwd);

      if (!diffRes.output) {
        return formatTextResponse(`No hay diferencias ${args.staged ? 'en stage' : 'sin staged'} en el repositorio.`);
      }

      return formatTextResponse(truncateString(diffRes.output, config.maxOutputChars));
    }

    case 'git_log': {
      const count = args.maxCommits || 15;
      const logRes = await execGit(`log -n ${count} --pretty=format:"%h - %an (%ar): %s"`, cwd);
      return formatTextResponse(logRes.output || 'No hay commits en este repositorio todavía.');
    }

    case 'git_commit': {
      if (args.files && args.files.length > 0) {
        for (const f of args.files) {
          await execGit(`add "${f}"`, cwd);
        }
      } else {
        await execGit('add -A', cwd);
      }

      const msgEscaped = args.message.replace(/"/g, '\\"');
      const commitRes = await execGit(`commit -m "${msgEscaped}"`, cwd);
      return formatTextResponse(commitRes.output, commitRes.isError);
    }

    case 'git_branch': {
      if (args.action === 'list') {
        const listRes = await execGit('branch -a', cwd);
        return formatTextResponse(listRes.output);
      } else if (args.action === 'create') {
        if (!args.branchName) return formatTextResponse('branchName es requerido para crear una rama.', true);
        const createRes = await execGit(`branch "${args.branchName}"`, cwd);
        return formatTextResponse(createRes.output || `Rama '${args.branchName}' creada con éxito.`);
      } else if (args.action === 'switch') {
        if (!args.branchName) return formatTextResponse('branchName es requerido para cambiar de rama.', true);
        const switchRes = await execGit(`checkout "${args.branchName}"`, cwd);
        return formatTextResponse(switchRes.output || `Cambiado a la rama '${args.branchName}'.`);
      }
      break;
    }

    default:
      return null;
  }
}

module.exports = {
  gitDevTools,
  handleGitDevTool,
};
