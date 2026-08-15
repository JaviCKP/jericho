const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { formatTextResponse, truncateString } = require('../utils/helpers');
const { isWindows } = require('../utils/platform');
const config = require('../config');
const logger = require('../utils/logger');

// Almacén de tareas en segundo plano
const backgroundTasks = new Map();
let nextTaskId = 1;

function getEnhancedEnv() {
  const nodeDir = path.dirname(process.execPath);
  const currentPath = process.env.PATH || process.env.Path || '';
  const enhancedPath = nodeDir ? `${nodeDir}${path.delimiter}${currentPath}` : currentPath;

  const env = { ...process.env };
  env.PATH = enhancedPath;
  if (isWindows) {
    env.Path = enhancedPath;
  }
  return env;
}

const terminalTools = [
  {
    name: 'run_command',
    description: 'Ejecuta un comando en la terminal (CMD/PowerShell en Windows, Bash en Unix) con captura de stdout, stderr, código de salida y tiempo de ejecución.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'El comando o script a ejecutar.',
        },
        cwd: {
          type: 'string',
          description: 'Directorio de trabajo (por defecto el directorio de trabajo actual o ChatGPT-Workspace).',
        },
        timeoutMs: {
          type: 'number',
          description: 'Tiempo máximo de espera en milisegundos (por defecto 60000 ms).',
        },
        shell: {
          type: 'string',
          enum: ['cmd', 'powershell', 'bash', 'default'],
          description: 'Shell a utilizar (por defecto cmd en Windows, bash en Unix).',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'run_background_command',
    description: 'Inicia un comando o servidor en segundo plano (ej. npm run dev, servidores web, watchers) sin bloquear la conversación y devuelve un identificador taskId para monitorizarlo.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'El comando a iniciar en segundo plano.',
        },
        cwd: {
          type: 'string',
          description: 'Directorio de trabajo opcional.',
        },
        taskName: {
          type: 'string',
          description: 'Nombre descriptivo de la tarea.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'get_background_task_output',
    description: 'Obtiene las últimas líneas de salida de texto (stdout/stderr) producidas por una tarea en segundo plano.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'El identificador taskId devuelto al crear la tarea.',
        },
        maxLines: {
          type: 'number',
          description: 'Número máximo de líneas a recuperar (por defecto 100).',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'kill_background_task',
    description: 'Detiene y finaliza un proceso o servidor que se esté ejecutando en segundo plano.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'El identificador taskId de la tarea a detener.',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'list_background_tasks',
    description: 'Lista todas las tareas y servidores activos en segundo plano.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_environment_vars',
    description: 'Obtiene variables de entorno del sistema con enmascaramiento automático de tokens y contraseñas sensibles.',
    inputSchema: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Nombres específicos de variables a consultar (ej. ["PATH", "USER", "NODE_ENV"]). Si se omite, lista las principales no sensibles.',
        },
      },
    },
  },
];

async function handleTerminalTool(name, args) {
  switch (name) {
    case 'run_command': {
      let cmd = args.command;
      const cwd = args.cwd ? path.resolve(args.cwd) : config.workspaceDir;
      const timeout = args.timeoutMs || config.defaultTimeoutMs;

      // Asegurar que el cwd existe
      if (!fs.existsSync(cwd)) {
        fs.mkdirSync(cwd, { recursive: true });
      }

      let shellExec = isWindows ? 'cmd.exe' : '/bin/bash';
      if (args.shell === 'powershell' && isWindows) {
        shellExec = 'powershell.exe';
      } else if (args.shell === 'cmd' && isWindows) {
        shellExec = 'cmd.exe';
      }

      const enhancedEnv = getEnhancedEnv();
      const startTime = Date.now();

      return new Promise((resolve) => {
        exec(
          cmd,
          {
            shell: shellExec,
            cwd: cwd,
            timeout: timeout,
            maxBuffer: 20 * 1024 * 1024,
            env: enhancedEnv,
          },
          (error, stdout, stderr) => {
            const durationMs = Date.now() - startTime;
            let outputText = '';

            if (stdout) {
              outputText += `=== STDOUT (${(stdout.length / 1024).toFixed(1)} KB) ===\n${stdout.trim()}\n\n`;
            }
            if (stderr) {
              outputText += `=== STDERR ===\n${stderr.trim()}\n\n`;
            }
            if (error) {
              outputText += `=== ERROR / EXIT STATUS ===\nExit Code: ${error.code || 'UNKNOWN'}\nMessage: ${error.message}\n`;
            }

            if (!outputText) {
              outputText = '(Comando ejecutado con éxito sin salida de consola)';
            }

            outputText += `\n[Directorio: ${cwd} | Duración: ${durationMs}ms | Código: ${error ? error.code || 1 : 0}]`;

            resolve(formatTextResponse(truncateString(outputText, config.maxOutputChars), !!error));
          }
        );
      });
    }

    case 'run_background_command': {
      const taskId = `task_${Date.now()}_${nextTaskId++}`;
      const cwd = args.cwd ? path.resolve(args.cwd) : config.workspaceDir;

      if (!fs.existsSync(cwd)) {
        fs.mkdirSync(cwd, { recursive: true });
      }

      const isWin = isWindows;
      const shellExec = isWin ? 'cmd.exe' : '/bin/bash';
      const shellArgs = isWin ? ['/c', args.command] : ['-c', args.command];

      const child = spawn(shellExec, shellArgs, {
        cwd: cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: getEnhancedEnv(),
      });

      const taskInfo = {
        id: taskId,
        name: args.taskName || args.command,
        command: args.command,
        cwd: cwd,
        pid: child.pid,
        startTime: new Date().toISOString(),
        status: 'RUNNING',
        logs: [],
        process: child,
      };

      child.stdout.on('data', (data) => {
        const text = data.toString();
        taskInfo.logs.push(`[${new Date().toLocaleTimeString()}] ${text}`);
        if (taskInfo.logs.length > 500) taskInfo.logs.shift();
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        taskInfo.logs.push(`[${new Date().toLocaleTimeString()}] [ERR] ${text}`);
        if (taskInfo.logs.length > 500) taskInfo.logs.shift();
      });

      child.on('close', (code) => {
        taskInfo.status = `EXITED (code ${code})`;
      });

      backgroundTasks.set(taskId, taskInfo);

      return formatTextResponse({
        message: 'Comando iniciado en segundo plano con éxito',
        taskId: taskId,
        pid: child.pid,
        command: args.command,
        cwd: cwd,
        consultarLogs: `get_background_task_output(taskId="${taskId}")`,
      });
    }

    case 'get_background_task_output': {
      const task = backgroundTasks.get(args.taskId);
      if (!task) {
        return formatTextResponse(`Error: No se encontró la tarea con taskId '${args.taskId}'.`, true);
      }

      const max = args.maxLines || 100;
      const recentLogs = task.logs.slice(-max).join('');

      return formatTextResponse(
        `=== LOGS DE TAREA: ${task.name} (PID: ${task.pid} | Estado: ${task.status}) ===\n` +
        (recentLogs || '(Sin salida acumulada todavía)')
      );
    }

    case 'kill_background_task': {
      const task = backgroundTasks.get(args.taskId);
      if (!task) {
        return formatTextResponse(`Error: No se encontró la tarea con taskId '${args.taskId}'.`, true);
      }

      try {
        if (isWindows && task.pid) {
          exec(`taskkill /PID ${task.pid} /F /T`);
        } else if (task.process) {
          task.process.kill('SIGKILL');
        }
        task.status = 'KILLED';
        return formatTextResponse(`Tarea '${task.name}' (PID: ${task.pid}) detenida y finalizada con éxito.`);
      } catch (err) {
        return formatTextResponse(`Error finalizando tarea: ${err.message}`, true);
      }
    }

    case 'list_background_tasks': {
      const list = [];
      for (const [id, t] of backgroundTasks.entries()) {
        list.push({
          taskId: id,
          name: t.name,
          command: t.command,
          pid: t.pid,
          status: t.status,
          startTime: t.startTime,
        });
      }

      return formatTextResponse({
        totalBackgroundTasks: list.length,
        tasks: list,
      });
    }

    case 'get_environment_vars': {
      const sensitiveKeys = ['KEY', 'SECRET', 'TOKEN', 'PASS', 'AUTH', 'CREDENTIAL', 'COOKIE', 'SALT'];
      const requested = args.names;
      const result = {};

      if (requested && requested.length > 0) {
        for (const name of requested) {
          const val = process.env[name];
          if (val === undefined) {
            result[name] = '(no definida)';
          } else {
            const isSensitive = sensitiveKeys.some((s) => name.toUpperCase().includes(s));
            result[name] = isSensitive ? 'sk-***[PROTEGIDO]***' : val;
          }
        }
      } else {
        const safeCommonKeys = [
          'OS', 'PROCESSOR_ARCHITECTURE', 'USER', 'USERNAME', 'USERPROFILE', 'HOME',
          'SHELL', 'TERM', 'NODE_ENV', 'LANG', 'PWD', 'PATH',
        ];
        for (const k of safeCommonKeys) {
          if (process.env[k]) {
            result[k] = process.env[k];
          }
        }
      }

      return formatTextResponse(result);
    }

    default:
      return null;
  }
}

module.exports = {
  terminalTools,
  handleTerminalTool,
};
