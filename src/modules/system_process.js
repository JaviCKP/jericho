const { exec } = require('child_process');
const { formatTextResponse } = require('../utils/helpers');
const { getPlatformInfo, isWindows, isMac, isLinux } = require('../utils/platform');

const systemProcessTools = [
  {
    name: 'get_system_health',
    description: 'Devuelve información completa del estado del ordenador: CPU, memoria libre/total, discos, usuario activo, elevación de Administrador y tiempo encendido (Windows, macOS y Linux).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_processes',
    description: 'Lista los procesos en ejecución en el sistema con su PID, nombre de ejecutable y consumo aproximado de memoria.',
    inputSchema: {
      type: 'object',
      properties: {
        filterName: {
          type: 'string',
          description: 'Filtro opcional para buscar procesos por nombre (ej. "node", "chrome", "python").',
        },
        maxProcesses: {
          type: 'number',
          description: 'Número máximo de procesos a mostrar (por defecto 50).',
        },
      },
    },
  },
  {
    name: 'kill_process',
    description: 'Finaliza forzosamente un proceso por su identificador PID o por el nombre de su ejecutable.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'ID del proceso a finalizar.' },
        processName: { type: 'string', description: 'Nombre del ejecutable a cerrar (ej. "notepad.exe", "node").' },
      },
    },
  },
  {
    name: 'open_app_or_url',
    description: 'Abre una aplicación, un archivo local con su programa predeterminado o una URL en el navegador (Windows, macOS y Linux).',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Nombre de la aplicación, ruta de archivo o URL web (ej. https://github.com).',
        },
      },
      required: ['target'],
    },
  },
];

async function handleSystemProcessTool(name, args) {
  switch (name) {
    case 'get_system_health': {
      const info = getPlatformInfo();

      if (isWindows) {
        return new Promise((resolve) => {
          exec('wmic logicaldisk get Caption,FreeSpace,Size,VolumeName /format:csv', (err, stdout) => {
            if (!err && stdout) {
              const lines = stdout.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('Node'));
              const disks = [];
              lines.forEach((line) => {
                const parts = line.split(',');
                if (parts.length >= 4 && parts[1]) {
                  const free = parseInt(parts[2], 10);
                  const size = parseInt(parts[3], 10);
                  if (size > 0) {
                    disks.push({
                      drive: parts[1],
                      label: parts[4] || '',
                      freeGB: (free / (1024 ** 3)).toFixed(1) + ' GB',
                      totalGB: (size / (1024 ** 3)).toFixed(1) + ' GB',
                      freePercent: ((free / size) * 100).toFixed(0) + '%',
                    });
                  }
                }
              });
              info.disks = disks;
            }
            resolve(formatTextResponse(info));
          });
        });
      } else {
        // macOS / Linux df -k
        return new Promise((resolve) => {
          exec('df -k /', (err, stdout) => {
            if (!err && stdout) {
              const lines = stdout.trim().split('\n');
              if (lines.length > 1) {
                const parts = lines[1].split(/\s+/);
                if (parts.length >= 4) {
                  const totalKB = parseInt(parts[1], 10);
                  const availKB = parseInt(parts[3], 10);
                  info.disks = [
                    {
                      mount: parts[5] || '/',
                      freeGB: (availKB / (1024 ** 2)).toFixed(1) + ' GB',
                      totalGB: (totalKB / (1024 ** 2)).toFixed(1) + ' GB',
                    },
                  ];
                }
              }
            }
            resolve(formatTextResponse(info));
          });
        });
      }
    }

    case 'list_processes': {
      const max = args.maxProcesses || 50;
      const filter = args.filterName ? args.filterName.toLowerCase() : null;

      if (isWindows) {
        const psCmd = `Get-Process | Sort-Object -Property WorkingSet64 -Descending | Select-Object -First ${max} Id, ProcessName, @{N='MemoryMB';E={[math]::Round($_.WorkingSet64/1MB,2)}} | ConvertTo-Json`;
        return new Promise((resolve) => {
          exec(psCmd, { shell: 'powershell.exe' }, (err, stdout) => {
            if (err) {
              resolve(formatTextResponse(`Error listando procesos: ${err.message}`, true));
            } else {
              try {
                let list = JSON.parse(stdout || '[]');
                if (!Array.isArray(list)) list = [list];
                if (filter) {
                  list = list.filter((p) => p.ProcessName.toLowerCase().includes(filter));
                }
                resolve(formatTextResponse({ totalReturned: list.length, processes: list }));
              } catch (e) {
                resolve(formatTextResponse(stdout));
              }
            }
          });
        });
      } else {
        return new Promise((resolve) => {
          exec(`ps aux | head -n ${max}`, (err, stdout) => {
            resolve(formatTextResponse(stdout || err.message));
          });
        });
      }
    }

    case 'kill_process': {
      if (!args.pid && !args.processName) {
        return formatTextResponse('Debes especificar al menos pid o processName.', true);
      }

      let cmd = '';
      if (isWindows) {
        if (args.pid) {
          cmd = `taskkill /PID ${args.pid} /F /T`;
        } else {
          cmd = `taskkill /IM "${args.processName}" /F /T`;
        }
      } else {
        if (args.pid) {
          cmd = `kill -9 ${args.pid}`;
        } else {
          cmd = `pkill -9 -f "${args.processName}"`;
        }
      }

      return new Promise((resolve) => {
        exec(cmd, (err, stdout, stderr) => {
          if (err) {
            resolve(formatTextResponse(`Error al cerrar proceso: ${stderr || err.message}`, true));
          } else {
            resolve(formatTextResponse(`Proceso finalizado correctamente: ${stdout || 'OK'}`));
          }
        });
      });
    }

    case 'open_app_or_url': {
      const target = args.target;
      let cmd = '';
      if (isWindows) {
        cmd = `start "" "${target}"`;
      } else if (isMac) {
        cmd = `open "${target}"`;
      } else {
        cmd = `xdg-open "${target}"`;
      }

      return new Promise((resolve) => {
        exec(cmd, (err) => {
          if (err) {
            resolve(formatTextResponse(`Error abriendo '${target}': ${err.message}`, true));
          } else {
            resolve(formatTextResponse(`Se ha abierto '${target}' con éxito.`));
          }
        });
      });
    }

    default:
      return null;
  }
}

module.exports = {
  systemProcessTools,
  handleSystemProcessTool,
};
