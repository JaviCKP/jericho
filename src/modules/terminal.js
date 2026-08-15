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

const terminalTools = [
  {
    name: 'run_command',
    description: 'Ejecuta un comando en la terminal (PowerShell en Windows, Bash en Unix) con captura de stdout, stderr, código de salida y tiempo de ejecución.',
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
          enum: ['powershell', 'cmd', 'bash', 'default'],
          description: 'Shell a utilizar (por defecto powershell en Windows, bash en Unix).',
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
    description: 'Inspecciona las variables de entorno del sistema o filtra por nombre.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Filtro opcional de texto para buscar variables específicas (ej. PATH, NODE, USER).',
        },
      },
    },
  },
];

async function handleTerminalTool(name, args) {
  switch (name) {
    case 'run_command': {
      const cmd = args.command;
      const cwd = args.cwd ? path.resolve(args.cwd) : config.workspaceDir;
      const timeout = args.timeoutMs || config.defaultTimeoutMs;
      let shellExec = isWindows ? 'powershell.exe' : '/bin/bash';

      if (args.shell === 'cmd' && isWindows) {
        shellExec = 'cmd.exe';
      } else if (args.shell === 'powershell' && isWindows) {
        shellExec = 'powershell.exe';
      }

      const startTime = Date.now();
      return new Promise((resolve) => {
        exec(
          cmd,
          {
            shell: shellExec,
            cwd: cwd,
            timeout: timeout,
            maxBuffer: 20 * 1024 * 1024, // 20 MB
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
      const shellExec = isWindows ? 'powershell.exe' : '/bin/bash';
      const shellArgs = isWindows ? ['-Command', args.command] : ['-c', args.command];

      const child = spawn(shellExec, shellArgs, {
        cwd: cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const taskInfo = {
        id: taskId,
        command: args.command,
        cwd: cwd,
        pid: child.pid,
        startTime: new Date().toISOString(),
        status: 'running',
        exitCode: null,
        logs: [],
        process: child,
      };

      child.stdout.on('data', (d) => {
        const lines = d.toString().split(/\r?\n/).filter(Boolean);
        taskInfo.logs.push(...lines.map((l) => `[STDOUT] ${l}`));
        if (taskInfo.logs.length > 2000) taskInfo.logs.splice(0, taskInfo.logs.length - 2000);
      });

      child.stderr.on('data', (d) => {
        const lines = d.toString().split(/\r?\n/).filter(Boolean);
        taskInfo.logs.push(...lines.map((l) => `[STDERR] ${l}`));
        if (taskInfo.logs.length > 2000) taskInfo.logs.splice(0, taskInfo.logs.length - 2000);
      });

      child.on('close', (code) => {
        taskInfo.status = 'completed';
        taskInfo.exitCode = code;
      });

      child.on('error', (err) => {
        taskInfo.status = 'error';
        taskInfo.logs.push(`[SYSTEM_ERROR] ${err.message}`);
      });

      backgroundTasks.set(taskId, taskInfo);

      return formatTextResponse({
        message: 'Tarea en segundo plano iniciada con éxito',
        taskId: taskId,
        pid: child.pid,
        command: args.command,
        cwd: cwd,
      });
    }

    case 'get_background_task_output': {
      const task = backgroundTasks.get(args.taskId);
      if (!task) {
        return formatTextResponse(`Error: No se encontró ninguna tarea activa o reciente con taskId '${args.taskId}'`, true);
      }

      const maxLines = args.maxLines || 100;
      const recentLogs = task.logs.slice(-maxLines);

      return formatTextResponse({
        taskId: task.id,
        command: task.command,
        pid: task.pid,
        status: task.status,
        exitCode: task.exitCode,
        startTime: task.startTime,
        totalLinesCaptured: task.logs.length,
        linesReturned: recentLogs.length,
        output: recentLogs.join('\n'),
      });
    }

    case 'kill_background_task': {
      const task = backgroundTasks.get(args.taskId);
      if (!task) {
        return formatTextResponse(`Error: No se encontró ninguna tarea con taskId '${args.taskId}'`, true);
      }

      if (task.status !== 'running') {
        return formatTextResponse(`La tarea '${args.taskId}' ya había finalizado con estado '${task.status}' (código: ${task.exitCode}).`);
      }

      try {
        if (isWindows && task.pid) {
          exec(`taskkill /PID ${task.pid} /T /F`);
        } else if (task.process) {
          task.process.kill('SIGTERM');
        }
        task.status = 'killed';
        return formatTextResponse(`Tarea '${args.taskId}' (PID ${task.pid}) finalizada con éxito.`);
      } catch (err) {
        return formatTextResponse(`Error intentando detener la tarea: ${err.message}`, true);
      }
    }

    case 'list_background_tasks': {
      const list = Array.from(backgroundTasks.values()).map((t) => ({
        taskId: t.id,
        command: t.command,
        pid: t.pid,
        status: t.status,
        exitCode: t.exitCode,
        startTime: t.startTime,
        totalLogs: t.logs.length,
      }));

      return formatTextResponse({
        totalTasks: list.length,
        activeTasks: list.filter((t) => t.status === 'running').length,
        tasks: list,
      });
    }

    case 'get_environment_vars': {
      const env = { ...process.env };
      // Ocultar tokens sensibles en logs
      if (env.CONTROL_PLANE_API_KEY) env.CONTROL_PLANE_API_KEY = 'sk-***[PROTEGIDO]***';
      if (env.OPENAI_API_KEY) env.OPENAI_API_KEY = 'sk-***[PROTEGIDO]***';

      const filter = args.filter ? args.filter.toLowerCase() : null;
      const result = {};

      for (const [k, v] of Object.entries(env)) {
        if (!filter || k.toLowerCase().includes(filter) || (v && v.toLowerCase().includes(filter))) {
          result[k] = v;
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
