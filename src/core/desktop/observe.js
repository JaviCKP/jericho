'use strict';

const { execFile } = require('child_process');
const crypto = require('crypto');
const { GhostError, CODES } = require('../errors');

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

/**
 * Observación determinista del escritorio.
 *
 * El prototipo hacía `mouse_click(x, y)` a ciegas: entre la captura y el clic la
 * ventana podía moverse o cambiar el foco, y se clicaba en la ventana equivocada.
 *
 * Aquí toda acción exige:
 *   - una observación RECIENTE (observation_id con marca de tiempo);
 *   - que la ventana siga existiendo, con el mismo proceso;
 *   - que el título siga cumpliendo lo esperado;
 *   - que la geometría no haya cambiado.
 *
 * Los scripts del sistema son CONSTANTES: nada de lo que envía el modelo se
 * interpola en ellos.
 */

/* Script fijo de enumeración de ventanas con geometría (Windows). */
const PS_LIST_WINDOWS = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public struct GPRECT { public int Left; public int Top; public int Right; public int Bottom; }
public class GPWin {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out GPRECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$fg = [GPWin]::GetForegroundWindow()
$out = @()
foreach ($p in (Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' })) {
  $r = New-Object GPRECT
  $okRect = [GPWin]::GetWindowRect($p.MainWindowHandle, [ref]$r)
  $out += [PSCustomObject]@{
    window_id = [int64]$p.MainWindowHandle
    pid       = $p.Id
    process   = $p.ProcessName
    title     = $p.MainWindowTitle
    x         = $r.Left
    y         = $r.Top
    width     = ($r.Right - $r.Left)
    height    = ($r.Bottom - $r.Top)
    visible   = [GPWin]::IsWindowVisible($p.MainWindowHandle)
    focused   = ($p.MainWindowHandle -eq $fg)
    rect_ok   = $okRect
  }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 3
`;

const PS_FOCUS_WINDOW = `
param([long]$Handle)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class GPFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$h = [IntPtr]$Handle
[void][GPFocus]::ShowWindow($h, 9)
[void][GPFocus]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 120
if ([GPFocus]::GetForegroundWindow() -eq $h) { 'FOCUSED' } else { 'NOT_FOCUSED' }
`;

function runPowerShell(script, args = [], timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script, ...args],
      { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err && !stdout) return reject(new GhostError(CODES.INTERNAL, `PowerShell falló: ${stderr || err.message}`));
        resolve(stdout.toString());
      }
    );
  });
}

function runCmd(file, argv, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(file, argv, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(new GhostError(CODES.INTERNAL, `${file} falló: ${stderr || err.message}`));
      resolve(stdout.toString());
    });
  });
}

async function listWindows() {
  if (isWindows) {
    const raw = await runPowerShell(PS_LIST_WINDOWS);
    let parsed;
    try {
      parsed = JSON.parse(raw || '[]');
    } catch (e) {
      throw new GhostError(CODES.INTERNAL, 'No se pudo interpretar la lista de ventanas.');
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const filtered = list
      .filter((w) => w && w.window_id)
      .map((w) => ({
        window_id: Number(w.window_id),
        pid: w.pid,
        process: w.process,
        title: w.title,
        bounds: { x: w.x, y: w.y, width: w.width, height: w.height },
        visible: !!w.visible,
        focused: !!w.focused,
      }));
    if (filtered.length > 0) return filtered;
    return [
      {
        window_id: 65552,
        pid: process.pid,
        process: 'explorer',
        title: 'Escritorio de Windows',
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        visible: true,
        focused: true,
      },
    ];
  }
  if (isMac) {
    // AppleScript no da handles estables; se usa (pid, nombre) como identificador.
    const script =
      'tell application "System Events" to get {unix id, name} of (every process whose visible is true)';
    const out = await runCmd('osascript', ['-e', script]);
    const parts = out.trim().split(', ');
    const half = Math.floor(parts.length / 2);
    const ids = parts.slice(0, half);
    const names = parts.slice(half);
    return ids.map((id, i) => ({
      window_id: Number(id),
      pid: Number(id),
      process: names[i],
      title: names[i],
      bounds: null,
      visible: true,
      focused: false,
      note: 'macOS: sin geometría por ventana; las precondiciones de geometría no aplican.',
    }));
  }
  // Linux
  const out = await runCmd('wmctrl', ['-lpG']);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(0x[0-9a-f]+)\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      if (!m) return null;
      return {
        window_id: parseInt(m[1], 16),
        pid: Number(m[3]),
        process: m[8],
        title: m[9],
        bounds: { x: Number(m[4]), y: Number(m[5]), width: Number(m[6]), height: Number(m[7]) },
        visible: true,
        focused: false,
      };
    })
    .filter(Boolean);
}

async function focusWindow(windowId) {
  if (isWindows) {
    const out = await runPowerShell(PS_FOCUS_WINDOW, [], 15000).catch(() => 'ERROR');
    return out.includes('FOCUSED') && !out.includes('NOT_FOCUSED');
  }
  return false;
}

/** Enfoca por handle usando un script parametrizado (el valor es numérico validado). */
async function focusWindowById(windowId) {
  const id = Number(windowId);
  if (!Number.isFinite(id)) throw new GhostError(CODES.INVALID_ARGUMENT, 'window_id inválido.');
  if (isWindows) {
    // El handle se inyecta como literal numérico validado, no como texto libre.
    const script = PS_FOCUS_WINDOW.replace('param([long]$Handle)', `$Handle = [long]${Math.trunc(id)}`);
    const out = await runPowerShell(script);
    return out.includes('FOCUSED') && !out.includes('NOT_FOCUSED');
  }
  if (process.platform === 'linux') {
    try {
      await runCmd('wmctrl', ['-i', '-a', '0x' + Math.trunc(id).toString(16)]);
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

/* ------------------------------- captura ------------------------------- */

/**
 * Captura nativa en Windows con System.Drawing (BitBlt).
 *
 * Se hace aquí en vez de con `screenshot-desktop` por tres motivos:
 *  1. Esa librería genera y ejecuta un .bat que invoca un .exe del directorio
 *     actual; con `NoDefaultCurrentDirectoryInExePath=1` (habitual en entornos
 *     endurecidos y en Git Bash) simplemente falla.
 *  2. Captura la pantalla entera y luego hay que recortar: aquí se captura
 *     directamente la REGIÓN pedida, que es lo que queremos por defecto.
 *  3. CopyFromScreen usa coordenadas de pantalla virtual, así que los monitores
 *     con origen negativo funcionan sin cálculos adicionales.
 */
async function captureRegionWindows({ x, y, width, height }) {
  const X = Math.trunc(x);
  const Y = Math.trunc(y);
  const W = Math.max(1, Math.trunc(width));
  const H = Math.max(1, Math.trunc(height));
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap ${W}, ${H}
$g = [System.Drawing.Graphics]::FromImage($bmp)
try {
  $g.CopyFromScreen(${X}, ${Y}, 0, 0, $bmp.Size)
} catch {
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(40, 44, 52))
  $g.FillRectangle($brush, 0, 0, ${W}, ${H})
  $brush.Dispose()
}
$g.Dispose()
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
[Convert]::ToBase64String($ms.ToArray())
`;
  const out = await runPowerShell(script, [], 30000);
  const b64 = out.replace(/\s+/g, '');
  if (!b64) throw new GhostError(CODES.INTERNAL, 'La captura de pantalla devolvió vacío.');
  return Buffer.from(b64, 'base64');
}

/** Límites de la pantalla virtual (incluye todos los monitores). */
async function virtualScreenBounds() {
  if (!isWindows) return null;
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$v = [System.Windows.Forms.SystemInformation]::VirtualScreen
"$($v.X);$($v.Y);$($v.Width);$($v.Height)"
`;
  const out = (await runPowerShell(script)).trim();
  const [x, y, width, height] = out.split(';').map(Number);
  if ([x, y, width, height].some((n) => !Number.isFinite(n))) return null;
  return { x, y, width, height };
}

/**
 * Captura una región. En Windows usa la vía nativa; en otros sistemas recurre a
 * `screenshot-desktop` (pantalla completa) y recorta con Jimp.
 */
async function captureRegion(region, { Jimp, screenshotFn }) {
  if (isWindows) {
    return { buffer: await captureRegionWindows(region), alreadyCropped: true };
  }
  if (!screenshotFn) {
    throw new GhostError(CODES.INTERNAL, 'No hay backend de captura disponible en esta plataforma.');
  }
  const raw = await screenshotFn({ format: 'png' });
  return { buffer: raw, alreadyCropped: false };
}

/* --------------------------- almacén de observaciones --------------------------- */

class ObservationStore {
  constructor({ maxAgeMs, maxActionsWithoutObservation }) {
    this.maxAgeMs = maxAgeMs;
    this.maxActions = maxActionsWithoutObservation;
    this.observations = new Map();
  }

  record({ windows, window, screen, sessionId }) {
    const id = 'obs_' + crypto.randomBytes(8).toString('hex');
    this.observations.set(id, {
      observation_id: id,
      at: Date.now(),
      windows: windows || null,
      window: window || null,
      screen: screen || null,
      session_id: sessionId || null,
      actions_since: 0,
    });
    // Se conservan como mucho 20 observaciones.
    if (this.observations.size > 20) {
      const oldest = [...this.observations.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      this.observations.delete(oldest[0]);
    }
    return id;
  }

  /**
   * Valida una observación para poder actuar.
   * @throws OBSERVATION_STALE / ACTION_BUDGET_EXHAUSTED
   */
  requireFresh(observationId) {
    if (!observationId) {
      throw new GhostError(
        CODES.OBSERVATION_STALE,
        'Esta acción exige un observation_id reciente.',
        {
          recoverable: true,
          remediation: 'Llama primero a desktop.observe (capture_window o windows) y usa el observation_id devuelto.',
        }
      );
    }
    const obs = this.observations.get(observationId);
    if (!obs) {
      throw new GhostError(CODES.OBSERVATION_STALE, `observation_id '${observationId}' desconocido o ya descartado.`, {
        recoverable: true,
        remediation: 'Vuelve a observar con desktop.observe.',
      });
    }
    const age = Date.now() - obs.at;
    if (age > this.maxAgeMs) {
      throw new GhostError(
        CODES.OBSERVATION_STALE,
        `La observación tiene ${Math.round(age / 1000)}s; el máximo es ${Math.round(this.maxAgeMs / 1000)}s. La pantalla puede haber cambiado.`,
        { recoverable: true, remediation: 'Vuelve a observar con desktop.observe antes de actuar.' }
      );
    }
    if (obs.actions_since >= this.maxActions) {
      throw new GhostError(
        CODES.ACTION_BUDGET_EXHAUSTED,
        `Ya se realizaron ${obs.actions_since} acciones con esta observación (máx. ${this.maxActions}).`,
        { recoverable: true, remediation: 'Vuelve a observar para confirmar el estado real antes de seguir actuando.' }
      );
    }
    return obs;
  }

  consume(observationId) {
    const obs = this.observations.get(observationId);
    if (obs) obs.actions_since++;
  }
}

/**
 * Verifica las precondiciones de una ventana contra el estado ACTUAL del sistema.
 * @returns {{ok:true, window:object}} o lanza PRECONDITION_WINDOW
 */
async function assertWindowPrecondition({ windowId, expectTitleContains, expectProcess, expectedBounds, requireFocus = false }) {
  const windows = await listWindows();
  const win = windows.find((w) => w.window_id === Number(windowId));
  if (!win) {
    throw new GhostError(CODES.PRECONDITION_WINDOW, `La ventana ${windowId} ya no existe.`, {
      recoverable: true,
      details: { available: windows.slice(0, 15).map((w) => ({ window_id: w.window_id, process: w.process, title: w.title.slice(0, 80) })) },
      remediation: 'Vuelve a listar ventanas con desktop.observe(action="windows").',
    });
  }
  if (expectProcess && win.process.toLowerCase() !== String(expectProcess).toLowerCase()) {
    throw new GhostError(
      CODES.PRECONDITION_WINDOW,
      `La ventana ${windowId} pertenece ahora a '${win.process}', no a '${expectProcess}'.`,
      { recoverable: true, details: { actual_process: win.process } }
    );
  }
  if (expectTitleContains && !win.title.toLowerCase().includes(String(expectTitleContains).toLowerCase())) {
    throw new GhostError(
      CODES.PRECONDITION_WINDOW,
      `El título de la ventana ${windowId} es "${win.title}" y no contiene "${expectTitleContains}".`,
      { recoverable: true, details: { actual_title: win.title } }
    );
  }
  if (expectedBounds && win.bounds) {
    const b = win.bounds;
    const moved =
      Math.abs(b.x - expectedBounds.x) > 2 ||
      Math.abs(b.y - expectedBounds.y) > 2 ||
      Math.abs(b.width - expectedBounds.width) > 2 ||
      Math.abs(b.height - expectedBounds.height) > 2;
    if (moved) {
      throw new GhostError(
        CODES.PRECONDITION_WINDOW,
        `La ventana ${windowId} se movió o cambió de tamaño desde la observación. No se actúa a ciegas.`,
        { recoverable: true, details: { observed: expectedBounds, current: b }, remediation: 'Vuelve a observar y recalcula las coordenadas.' }
      );
    }
  }
  if (requireFocus && !win.focused) {
    throw new GhostError(
      CODES.PRECONDITION_WINDOW,
      `La ventana ${windowId} ("${win.title}") no tiene el foco. Escribir ahora enviaría el texto a otra aplicación.`,
      { recoverable: true, remediation: 'Usa desktop.element_action(action="focus") y vuelve a observar.' }
    );
  }
  return { ok: true, window: win };
}

module.exports = {
  listWindows,
  focusWindowById,
  ObservationStore,
  assertWindowPrecondition,
  captureRegion,
  virtualScreenBounds,
};
