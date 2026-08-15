const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { formatTextResponse, truncateString } = require('../utils/helpers');
const config = require('../config');

function execGit(command, cwd) {
  const targetDir = cwd || config.workspaceDir;
  return new Promise((resolve) => {
    if (!fs.existsSync(targetDir)) {
      return resolve({ output: `Directorio no encontrado: ${targetDir}`, isError: true });
    }

    exec(`git ${command}`, { cwd: targetDir, maxBuffer: 10 * 1024 * 1024, env: { ...process.env } }, (err, stdout, stderr) => {
      if (err) {
        resolve({ output: (stderr || stdout || err.message).trim(), isError: true });
      } else {
        resolve({ output: stdout.trim() || '(Sin salida)', isError: false });
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
        repoPath: { type: 'string', description: 'Alias para cwd.' },
        projectPath: { type: 'string', description: 'Alias para cwd.' },
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
        repoPath: { type: 'string', description: 'Alias para cwd.' },
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
        maxEntries: { type: 'number', description: 'Alias para maxCommits.' },
        cwd: { type: 'string', description: 'Ruta del repositorio.' },
        repoPath: { type: 'string', description: 'Alias para cwd.' },
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
          description: 'Lista de archivos a añadir al stage. Si se omite o es ["."], añade todos (git add -A).',
        },
        cwd: { type: 'string', description: 'Ruta del repositorio.' },
      },
      required: ['message'],
    },
  },
  {
    name: 'git_branch',
    description: 'Lista, crea o cambia de rama en el repositorio.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'checkout', 'delete'],
          description: 'Acción sobre las ramas (por defecto "list").',
        },
        branchName: { type: 'string', description: 'Nombre de la rama (requerido para create, checkout y delete).' },
        cwd: { type: 'string', description: 'Ruta del repositorio.' },
      },
    },
  },
];

async function handleGitDevTool(name, args) {
  const rawDir = args.cwd || args.repoPath || args.projectPath || config.workspaceDir;
  const cwd = path.resolve(rawDir);

  switch (name) {
    case 'git_status': {
      const res = await execGit('status', cwd);
      return formatTextResponse(res.output, res.isError);
    }

    case 'git_diff': {
      let cmd = 'diff';
      if (args.staged) cmd += ' --staged';
      if (args.filePath) cmd += ` -- "${args.filePath}"`;

      const res = await execGit(cmd, cwd);
      return formatTextResponse(truncateString(res.output, config.maxOutputChars), res.isError);
    }

    case 'git_log': {
      const max = args.maxCommits || args.maxEntries || 15;
      const cmd = `log -n ${max} --pretty=format:"commit %h%d%nAuthor: %an <%ae>%nDate:   %ad%n%n    %s%n" --date=iso`;
      const res = await execGit(cmd, cwd);
      return formatTextResponse(truncateString(res.output, config.maxOutputChars), res.isError);
    }

    case 'git_commit': {
      const files = args.files && args.files.length > 0 ? args.files.join(' ') : '-A';
      const addRes = await execGit(`add ${files}`, cwd);
      if (addRes.isError) {
        return formatTextResponse(`Error al añadir archivos al stage: ${addRes.output}`, true);
      }

      const safeMsg = (args.message || 'Auto-commit').replace(/"/g, '\\"');
      const commitRes = await execGit(`commit -m "${safeMsg}"`, cwd);
      return formatTextResponse(commitRes.output, commitRes.isError);
    }

    case 'git_branch': {
      const action = args.action || 'list';
      if (action === 'list') {
        const res = await execGit('branch -a', cwd);
        return formatTextResponse(res.output, res.isError);
      }
      if (action === 'create') {
        if (!args.branchName) return formatTextResponse('Debes especificar branchName para crear una rama.', true);
        const res = await execGit(`branch "${args.branchName}"`, cwd);
        return formatTextResponse(res.output || `Rama '${args.branchName}' creada con éxito.`, res.isError);
      }
      if (action === 'checkout') {
        if (!args.branchName) return formatTextResponse('Debes especificar branchName para checkout.', true);
        const res = await execGit(`checkout "${args.branchName}"`, cwd);
        return formatTextResponse(res.output, res.isError);
      }
      if (action === 'delete') {
        if (!args.branchName) return formatTextResponse('Debes especificar branchName para borrar.', true);
        const res = await execGit(`branch -d "${args.branchName}"`, cwd);
        return formatTextResponse(res.output, res.isError);
      }

      return formatTextResponse(`Acción de rama no válida: ${action}`, true);
    }

    default:
      return null;
  }
}

module.exports = {
  gitDevTools,
  handleGitDevTool,
};
