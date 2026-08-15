'use strict';

const { ALL_TOOLS } = require('./catalog');

/**
 * Perfiles de herramientas.
 *
 * El modelo no recibe las 18 herramientas a la vez: recibe las de los perfiles
 * que una persona haya activado en la política. Por defecto core_read +
 * development = 12 herramientas.
 *
 * `admin` está desactivado por defecto y hay que activarlo explícitamente.
 */

const PROFILES = {};
for (const tool of ALL_TOOLS) {
  if (!PROFILES[tool.profile]) PROFILES[tool.profile] = new Set();
  PROFILES[tool.profile].add(tool.name);
}

const PROFILE_DESCRIPTIONS = {
  core_read: 'Lectura local segura: inspección, búsqueda, lectura de archivos, reanudación de contexto e inspección de Git.',
  development: 'Trabajo de desarrollo: parches atómicos, ejecución de programas permitidos, verificación, memoria y commits locales.',
  desktop: 'Automatización de escritorio determinista: observación por ventana, acciones sobre elementos y teclado.',
  network: 'Red acotada: lectura de páginas https y llamadas HTTP a destinos con alias.',
  admin: 'Acciones administrativas de una lista cerrada. DESACTIVADO por defecto.',
};

/**
 * Alias de compatibilidad: nombre v1 -> herramienta v2 equivalente.
 *
 * No se ejecutan automáticamente; el servidor devuelve un error explicativo con
 * la equivalencia para que una conversación antigua no falle en silencio.
 * Se puede activar la traducción automática con GHOSTPC_LEGACY_ALIASES=translate.
 */
const LEGACY_ALIASES = {
  // task_engine
  get_agent_protocol: { tool: 'ghostpc.status', note: 'Las reglas ya no son un prompt: son política del servidor. ghostpc.status devuelve los límites reales.' },
  list_pending_tasks: { tool: 'memory.resume', args: { action: 'list_items' } },
  resume_task_session: { tool: 'memory.resume', args: { action: 'load' } },
  save_or_update_task: { tool: 'memory.checkpoint', args: { action: 'update' }, note: 'Ahora exige expected_revision (compare-and-swap).' },
  memory_bank: { tool: 'memory.propose_rule', note: 'El agente ya no puede escribir reglas globales; sólo proponerlas para aprobación humana.' },
  // filesystem
  read_file: { tool: 'workspace.read' },
  write_file: { tool: 'workspace.apply_patch', note: 'La escritura completa se sustituye por parches atómicos con precondición de hash.' },
  edit_file_replace: { tool: 'workspace.apply_patch', note: 'La edición por buscar/reemplazar era ambigua; ahora se usa diff unificado.' },
  search_files: { tool: 'workspace.search', args: { mode: 'files' } },
  grep_in_files: { tool: 'workspace.search', args: { mode: 'content' } },
  get_directory_tree: { tool: 'workspace.inspect', args: { action: 'tree' } },
  file_operations: { tool: 'workspace.apply_patch', note: 'copy/move/delete arbitrarios se eliminaron. Un diff puede crear y borrar archivos dentro de la raíz.' },
  // terminal
  run_command: { tool: 'terminal.exec', args: { action: 'run' }, note: 'Ya no acepta cadenas de shell: programa de la allowlist + argv.' },
  run_background_command: { tool: 'terminal.exec', args: { action: 'start_background' } },
  get_background_task_output: { tool: 'terminal.exec', args: { action: 'logs' } },
  kill_background_task: { tool: 'terminal.exec', args: { action: 'stop' } },
  list_background_tasks: { tool: 'terminal.exec', args: { action: 'list' } },
  get_environment_vars: { tool: 'ghostpc.status', note: 'ELIMINADA. Los valores de entorno nunca vuelven al modelo. ghostpc.status lista los NOMBRES de secretos disponibles.' },
  // checkpoints
  save_context_checkpoint: { tool: 'memory.checkpoint', args: { action: 'update' } },
  load_context_checkpoint: { tool: 'memory.resume', args: { action: 'load' } },
  list_context_checkpoints: { tool: 'memory.resume', args: { action: 'list_items' } },
  store_memory: { tool: 'memory.checkpoint', args: { action: 'record_decision' } },
  recall_memory: { tool: 'memory.resume', args: { action: 'load' } },
  // git
  git_status: { tool: 'git.inspect', args: { action: 'status' } },
  git_diff: { tool: 'git.inspect', args: { action: 'diff' } },
  git_log: { tool: 'git.inspect', args: { action: 'log' } },
  git_commit: { tool: 'git.commit', args: { action: 'commit' }, note: 'Ahora exige la lista explícita de archivos; no hay `git add -A`.' },
  git_branch: { tool: 'git.inspect', args: { action: 'branches' }, note: 'Crear/borrar/cambiar de rama se retiró del agente.' },
  // system_process
  get_system_health: { tool: 'ghostpc.status', note: 'ELIMINADA como herramienta separada; los datos de sistema no aportaban al trabajo y filtraban información del host.' },
  list_processes: { tool: 'terminal.exec', args: { action: 'list' }, note: 'Sólo se listan los procesos creados por GhostPC.' },
  kill_process: { tool: 'terminal.exec', args: { action: 'stop' }, note: 'Sólo se pueden detener procesos creados por GhostPC, con verificación anti-reutilización de PID.' },
  open_app_or_url: { tool: null, note: 'ELIMINADA. Abrir aplicaciones o URLs arbitrarias era una ruta de exfiltración y de ejecución.' },
  // vision_gui
  take_screenshot: { tool: 'desktop.observe', args: { action: 'capture_window' }, note: 'Por defecto se captura una ventana, no la pantalla completa.' },
  mouse_click: { tool: 'desktop.element_action', args: { action: 'click' }, note: 'Ahora exige window_id y observation_id reciente.' },
  mouse_move: { tool: null, note: 'ELIMINADA: mover el cursor sin actuar no aporta y rompía el determinismo.' },
  mouse_drag: { tool: 'desktop.element_action', args: { action: 'drag' } },
  mouse_scroll: { tool: 'desktop.element_action', args: { action: 'scroll' } },
  type_text: { tool: 'desktop.keyboard', args: { action: 'type' } },
  press_hotkey: { tool: 'desktop.keyboard', args: { action: 'hotkey' } },
  get_screen_metrics: { tool: 'desktop.observe', args: { action: 'metrics' } },
  list_windows: { tool: 'desktop.observe', args: { action: 'windows' } },
  focus_window: { tool: 'desktop.element_action', args: { action: 'focus' } },
  // network
  fetch_web_page: { tool: 'web.fetch_readonly' },
  check_port: { tool: null, note: 'ELIMINADA: era una primitiva de escaneo de red sin valor para el trabajo de desarrollo.' },
  http_request: { tool: 'http.call_allowlisted', note: 'Ya no acepta URLs libres: sólo alias de destino con métodos declarados.' },
};

module.exports = { PROFILES, PROFILE_DESCRIPTIONS, LEGACY_ALIASES };
