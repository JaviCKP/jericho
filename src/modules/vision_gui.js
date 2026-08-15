const screenshot = require('screenshot-desktop');
const { mouse, keyboard, screen, Point, Button, Key } = require('@nut-tree-fork/nut-js');
const { Jimp } = require('jimp');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { formatTextResponse, formatImageResponse } = require('../utils/helpers');
const logger = require('../utils/logger');
const { isWindows, isMac, isLinux } = require('../utils/platform');

// Configuración de respuesta ágil para nut-js
mouse.config.autoDelayMs = 15;
keyboard.config.autoDelayMs = 15;

const KEY_MAP = {
  enter: Key.Enter,
  return: Key.Return,
  tab: Key.Tab,
  escape: Key.Escape,
  esc: Key.Escape,
  backspace: Key.Backspace,
  space: Key.Space,
  delete: Key.Delete,
  up: Key.Up,
  down: Key.Down,
  left: Key.Left,
  right: Key.Right,
  home: Key.Home,
  end: Key.End,
  pageup: Key.PageUp,
  pagedown: Key.PageDown,
  f1: Key.F1,
  f2: Key.F2,
  f3: Key.F3,
  f4: Key.F4,
  f5: Key.F5,
  f6: Key.F6,
  f7: Key.F7,
  f8: Key.F8,
  f9: Key.F9,
  f10: Key.F10,
  f11: Key.F11,
  f12: Key.F12,
  win: Key.LeftSuper,
  windows: Key.LeftSuper,
  super: Key.LeftSuper,
  cmd: Key.LeftSuper,
  command: Key.LeftSuper,
  ctrl: Key.LeftControl,
  control: Key.LeftControl,
  alt: Key.LeftAlt,
  option: Key.LeftAlt,
  shift: Key.LeftShift,
};

async function drawCoordinateGrid(imageBuffer, step = 200) {
  try {
    const image = await Jimp.read(imageBuffer);
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    const gridColor = 0xFF000088; // Rojo semitransparente

    for (let x = 0; x < width; x += step) {
      for (let y = 0; y < height; y++) {
        image.setPixelColor(gridColor, x, y);
      }
    }
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x++) {
        image.setPixelColor(gridColor, x, y);
      }
    }

    return await image.getBuffer('image/png');
  } catch (err) {
    logger.warn('Error aplicando cuadrícula de coordenadas', { error: err.message });
    return imageBuffer;
  }
}

const visionGuiTools = [
  {
    name: 'take_screenshot',
    description: 'Captura la pantalla completa en tiempo real y la devuelve como imagen PNG. Opcionalmente añade una cuadrícula de coordenadas cada 200px para calcular clics exactos.',
    inputSchema: {
      type: 'object',
      properties: {
        withCoordinateGrid: {
          type: 'boolean',
          description: 'Si es true, dibuja una cuadrícula de coordenadas sobre la imagen para identificar coordenadas X/Y.',
        },
        savePath: {
          type: 'string',
          description: 'Ruta opcional en disco donde guardar una copia del archivo PNG.',
        },
      },
    },
  },
  {
    name: 'mouse_click',
    description: 'Mueve el cursor del ratón a una coordenada específica (X, Y) y realiza un clic (izquierdo, derecho, doble clic o triple clic).',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Coordenada horizontal X en píxeles' },
        y: { type: 'number', description: 'Coordenada vertical Y en píxeles' },
        button: {
          type: 'string',
          enum: ['left', 'right', 'middle'],
          description: 'Botón del ratón (por defecto "left")',
        },
        clicks: {
          type: 'number',
          description: 'Número de clics: 1 = normal, 2 = doble clic (por defecto 1)',
        },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'mouse_move',
    description: 'Mueve el cursor del ratón a las coordenadas (X, Y) sin hacer clic.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Coordenada horizontal X' },
        y: { type: 'number', description: 'Coordenada vertical Y' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'mouse_drag',
    description: 'Arrastra el ratón manteniendo presionado el botón izquierdo desde una posición hasta las coordenadas de destino.',
    inputSchema: {
      type: 'object',
      properties: {
        startX: { type: 'number', description: 'Coordenada X inicial (opcional)' },
        startY: { type: 'number', description: 'Coordenada Y inicial (opcional)' },
        endX: { type: 'number', description: 'Coordenada X final' },
        endY: { type: 'number', description: 'Coordenada Y final' },
      },
      required: ['endX', 'endY'],
    },
  },
  {
    name: 'mouse_scroll',
    description: 'Desplaza la rueda del ratón (scroll) hacia arriba o abajo en la posición actual.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'Cantidad de desplazamiento. Positivo para bajar (ej. 5), negativo para subir (ej. -5).',
        },
      },
      required: ['amount'],
    },
  },
  {
    name: 'type_text',
    description: 'Escribe texto simulando pulsaciones reales de teclado en el elemento enfocado.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'El texto a escribir' },
      },
      required: ['text'],
    },
  },
  {
    name: 'press_hotkey',
    description: 'Presiona combinaciones de teclas o atajos (ej: ["ctrl", "c"], ["cmd", "space"], ["alt", "tab"], ["win", "r"], ["enter"]).',
    inputSchema: {
      type: 'object',
      properties: {
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista de teclas a presionar simultáneamente en orden.',
        },
      },
      required: ['keys'],
    },
  },
  {
    name: 'get_screen_metrics',
    description: 'Obtiene las dimensiones de la pantalla principal en píxeles (ancho y alto).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_windows',
    description: 'Lista las ventanas abiertas y visibles en el escritorio con su identificador, título y nombre de aplicación (Compatible con Windows, macOS y Linux).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'focus_window',
    description: 'Trae una ventana al primer plano del escritorio según su título o nombre de aplicación (Compatible con Windows, macOS y Linux).',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Nombre de la aplicación o título de ventana a enfocar (ej. "Visual Studio Code", "Chrome", "Terminal", "Notepad").',
        },
      },
      required: ['title'],
    },
  },
];

async function handleVisionGuiTool(name, args) {
  switch (name) {
    case 'take_screenshot': {
      let imgBuffer = await screenshot({ format: 'png' });
      const width = await screen.width();
      const height = await screen.height();

      if (args && args.withCoordinateGrid) {
        imgBuffer = await drawCoordinateGrid(imgBuffer, 200);
      }

      if (args && args.savePath) {
        const fullPath = path.resolve(args.savePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, imgBuffer);
      }

      const b64 = imgBuffer.toString('base64');
      const desc = `Captura de pantalla en tiempo real (${width}x${height} px).` +
        (args && args.withCoordinateGrid ? ' [Cuadrícula de coordenadas cada 200px superpuesta]' : '') +
        (args && args.savePath ? ` Guardada en: ${path.resolve(args.savePath)}` : '');

      return formatImageResponse(b64, desc);
    }

    case 'mouse_click': {
      const targetX = Math.round(args.x);
      const targetY = Math.round(args.y);
      const btn = (args.button || 'left').toLowerCase();
      const clicks = args.clicks || 1;

      await mouse.setPosition(new Point(targetX, targetY));
      const nutBtn = btn === 'right' ? Button.RIGHT : btn === 'middle' ? Button.MIDDLE : Button.LEFT;

      if (clicks === 2) {
        await mouse.doubleClick(nutBtn);
      } else {
        for (let i = 0; i < clicks; i++) {
          await mouse.click(nutBtn);
        }
      }
      return formatTextResponse(`Clic (${btn}, ${clicks}x) ejecutado en coordenadas (${targetX}, ${targetY}).`);
    }

    case 'mouse_move': {
      const targetX = Math.round(args.x);
      const targetY = Math.round(args.y);
      await mouse.setPosition(new Point(targetX, targetY));
      return formatTextResponse(`Cursor movido a (${targetX}, ${targetY}).`);
    }

    case 'mouse_drag': {
      if (args.startX !== undefined && args.startY !== undefined) {
        await mouse.setPosition(new Point(Math.round(args.startX), Math.round(args.startY)));
      }
      await mouse.pressButton(Button.LEFT);
      await mouse.setPosition(new Point(Math.round(args.endX), Math.round(args.endY)));
      await mouse.releaseButton(Button.LEFT);
      return formatTextResponse(`Arrastre completado hasta (${args.endX}, ${args.endY}).`);
    }

    case 'mouse_scroll': {
      const amt = args.amount;
      if (amt > 0) {
        await mouse.scrollDown(amt);
      } else {
        await mouse.scrollUp(Math.abs(amt));
      }
      return formatTextResponse(`Scroll de ratón completado: ${amt}`);
    }

    case 'type_text': {
      await keyboard.type(args.text);
      return formatTextResponse(`Texto escrito en el elemento activo: "${args.text}"`);
    }

    case 'press_hotkey': {
      const rawKeys = args.keys || [];
      const nutKeys = [];
      for (const k of rawKeys) {
        const lower = k.toLowerCase().trim();
        if (KEY_MAP[lower] !== undefined) {
          nutKeys.push(KEY_MAP[lower]);
        } else if (lower.length === 1) {
          const upperChar = lower.toUpperCase();
          if (Key[upperChar] !== undefined) {
            nutKeys.push(Key[upperChar]);
          }
        }
      }

      if (nutKeys.length === 0) {
        return formatTextResponse(`Error: No se reconocieron las teclas: ${JSON.stringify(rawKeys)}`, true);
      }

      for (const nk of nutKeys) {
        await keyboard.pressKey(nk);
      }
      for (let i = nutKeys.length - 1; i >= 0; i--) {
        await keyboard.releaseKey(nutKeys[i]);
      }
      return formatTextResponse(`Atajo de teclado ejecutado: ${rawKeys.join(' + ')}`);
    }

    case 'get_screen_metrics': {
      const width = await screen.width();
      const height = await screen.height();
      return formatTextResponse({
        screenWidth: width,
        screenHeight: height,
        platform: process.platform,
        units: 'pixels',
      });
    }

    case 'list_windows': {
      if (isWindows) {
        const psCmd = `Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json`;
        return new Promise((resolve) => {
          exec(psCmd, { shell: 'powershell.exe' }, (err, stdout) => {
            if (err) return resolve(formatTextResponse(`Error: ${err.message}`, true));
            try {
              let windows = JSON.parse(stdout || '[]');
              if (!Array.isArray(windows)) windows = [windows];
              resolve(formatTextResponse({ totalWindows: windows.length, windows: windows }));
            } catch (e) {
              resolve(formatTextResponse(stdout || 'No se encontraron ventanas visibles.'));
            }
          });
        });
      } else if (isMac) {
        // macOS AppleScript
        const osaCmd = `osascript -e 'tell application "System Events" to get name of every process whose visible is true'`;
        return new Promise((resolve) => {
          exec(osaCmd, (err, stdout) => {
            if (err) return resolve(formatTextResponse(`Error en macOS: ${err.message}`, true));
            const apps = stdout.split(',').map((a) => ({ name: a.trim() })).filter((a) => a.name);
            resolve(formatTextResponse({ totalWindows: apps.length, applications: apps }));
          });
        });
      } else if (isLinux) {
        // Linux wmctrl fallback
        return new Promise((resolve) => {
          exec('wmctrl -l', (err, stdout) => {
            if (err) {
              return resolve(formatTextResponse('Para listar ventanas en Linux se recomienda instalar wmctrl: sudo apt-get install wmctrl', false));
            }
            const lines = stdout.split('\n').filter(Boolean);
            resolve(formatTextResponse({ totalWindows: lines.length, raw: lines }));
          });
        });
      }
      return formatTextResponse('Listado no disponible para este OS.');
    }

    case 'focus_window': {
      const query = args.title;

      if (isWindows) {
        const safeQuery = query.replace(/'/g, "''");
        const psScript = `
          $target = Get-Process | Where-Object { $_.MainWindowTitle -like '*${safeQuery}*' -or $_.ProcessName -like '*${safeQuery}*' } | Select-Object -First 1
          if ($target) {
              $h = $target.MainWindowHandle
              Add-Type @"
              using System;
              using System.Runtime.InteropServices;
              public class WinFocus {
                  [DllImport("user32.dll")]
                  public static extern bool SetForegroundWindow(IntPtr hWnd);
                  [DllImport("user32.dll")]
                  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
              }
"@
              [WinFocus]::ShowWindow($h, 9)
              [WinFocus]::SetForegroundWindow($h)
              Write-Output "OK: $($target.MainWindowTitle) ($($target.ProcessName))"
          } else {
              Write-Output "NOT_FOUND"
          }
        `;
        return new Promise((resolve) => {
          exec(psScript, { shell: 'powershell.exe' }, (err, stdout) => {
            if (err) return resolve(formatTextResponse(`Error: ${err.message}`, true));
            const out = stdout.trim();
            if (out.startsWith('OK:')) {
              resolve(formatTextResponse(`Ventana enfocada: ${out.replace('OK:', '').trim()}`));
            } else {
              resolve(formatTextResponse(`No se encontró ninguna ventana con '${query}'`, true));
            }
          });
        });
      } else if (isMac) {
        const osaCmd = `osascript -e 'tell application "${query}" to activate'`;
        return new Promise((resolve) => {
          exec(osaCmd, (err) => {
            if (err) return resolve(formatTextResponse(`Error activando '${query}' en macOS: ${err.message}`, true));
            resolve(formatTextResponse(`Aplicación '${query}' traída al frente con éxito.`));
          });
        });
      } else if (isLinux) {
        return new Promise((resolve) => {
          exec(`wmctrl -a "${query}"`, (err) => {
            if (err) return resolve(formatTextResponse(`Error: ejecuta 'sudo apt-get install wmctrl' para control de foco en Linux.`, true));
            resolve(formatTextResponse(`Ventana '${query}' enfocada en Linux.`));
          });
        });
      }
      return formatTextResponse('Enfoque no soportado en esta plataforma.', true);
    }

    default:
      return null;
  }
}

module.exports = {
  visionGuiTools,
  handleVisionGuiTool,
};
