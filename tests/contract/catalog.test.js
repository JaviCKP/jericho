'use strict';

/**
 * Pruebas contractuales del catálogo.
 *
 * Comprueban de forma ESTRUCTURAL las propiedades que el prototipo no cumplía:
 * esquemas estrictos, anotaciones, esquemas de salida, versiones, y el
 * chokepoint (ninguna herramienta ejecuta nada por su cuenta).
 */

const fs = require('fs');
const path = require('path');
const h = require('../harness');
const { ALL_TOOLS, BY_NAME, toMcpTool } = require('../../src/tools/catalog');
const { PROFILES, LEGACY_ALIASES } = require('../../src/tools/profiles');
const { IMPLEMENTATIONS } = require('../../src/tools');
const { validate } = require('../../src/tools/validate');

const IMPL_DIR = path.resolve(__dirname, '../../src/tools/impl');

async function run() {
  h.suite('contrato :: metadatos obligatorios de cada herramienta');

  for (const t of ALL_TOOLS) {
    await h.test(`${t.name} declara todos los metadatos`, () => {
      h.ok(/^[a-z][a-z_]*\.[a-z_]+$/.test(t.name), `nombre no canónico: ${t.name}`);
      h.ok(/^\d+\.\d+\.\d+$/.test(t.version), 'falta versión semántica');
      h.ok(typeof t.description === 'string' && t.description.length > 60, 'descripción demasiado corta o ausente');
      h.ok(Number.isInteger(t.risk) && t.risk >= 0 && t.risk <= 4, 'nivel de riesgo inválido');
      h.ok(Number.isInteger(t.timeoutMs) && t.timeoutMs > 0, 'timeout inválido');
      h.ok(PROFILES[t.profile], `perfil desconocido: ${t.profile}`);

      const a = t.annotations;
      h.ok(a && typeof a.title === 'string', 'falta annotations.title');
      for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
        h.equal(typeof a[hint], 'boolean', `falta annotations.${hint}`);
      }

      h.equal(t.inputSchema.type, 'object');
      h.equal(t.inputSchema.additionalProperties, false, 'inputSchema debe cerrar additionalProperties');
      h.ok(t.outputSchema, 'falta outputSchema');
      h.ok(t.outputSchema.required.includes('ok'), 'outputSchema debe exigir ok');
      h.ok(t.outputSchema.required.includes('trace_id'), 'outputSchema debe exigir trace_id');
    });
  }

  h.suite('contrato :: coherencia de anotaciones con el riesgo');

  for (const t of ALL_TOOLS) {
    await h.test(`${t.name}: readOnlyHint coherente con el riesgo`, () => {
      if (t.annotations.readOnlyHint) {
        h.ok(t.risk <= 2, `una herramienta de sólo lectura no puede ser R${t.risk}`);
        h.equal(t.annotations.destructiveHint, false, 'sólo lectura no puede ser destructiva');
      }
      if (t.risk >= 3) {
        h.equal(t.annotations.readOnlyHint, false, `R${t.risk} no puede marcarse readOnly`);
      }
    });
  }

  h.suite('contrato :: catálogo e implementaciones cuadran');

  await h.test('toda herramienta del catálogo tiene implementación', () => {
    const faltan = ALL_TOOLS.filter((t) => !IMPLEMENTATIONS[t.name]).map((t) => t.name);
    h.equal(faltan.length, 0, `sin implementar: ${faltan.join(', ')}`);
  });

  await h.test('toda implementación está en el catálogo', () => {
    const sobran = Object.keys(IMPLEMENTATIONS).filter((n) => !BY_NAME.has(n));
    h.equal(sobran.length, 0, `implementadas pero no declaradas: ${sobran.join(', ')}`);
  });

  await h.test('toda implementación expone run()', () => {
    for (const [name, impl] of Object.entries(IMPLEMENTATIONS)) {
      h.equal(typeof impl.run, 'function', `${name} no expone run()`);
    }
  });

  await h.test('los nombres son únicos', () => {
    h.equal(new Set(ALL_TOOLS.map((t) => t.name)).size, ALL_TOOLS.length);
  });

  h.suite('contrato :: chokepoint (ninguna herramienta ejecuta por su cuenta)');

  const PROHIBIDOS = [
    { re: /require\(['"]child_process['"]\)/, motivo: 'child_process directo (debe usar runtime.runner)' },
    { re: /\bfetch\s*\(/, motivo: 'fetch directo (debe usar runtime.net)' },
    { re: /require\(['"]https?['"]\)/, motivo: 'módulo http/https directo (debe usar runtime.net)' },
    { re: /fs\.writeFileSync\(/, motivo: 'escritura no atómica (debe usar core/atomic o el motor de parches)' },
    { re: /fs\.rmSync\(|fs\.unlinkSync\(|fs\.rmdirSync\(/, motivo: 'borrado directo' },
    { re: /process\.env\[/, motivo: 'lectura directa de process.env (debe usar SecretBroker)' },
    { re: /materializeForProcess/, motivo: 'uso directo del materializador de secretos' },
  ];

  for (const file of fs.readdirSync(IMPL_DIR).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(IMPL_DIR, file), 'utf-8');
    for (const { re, motivo } of PROHIBIDOS) {
      await h.test(`impl/${file} no usa ${motivo}`, () => {
        const m = src.match(re);
        h.equal(m, null, `encontrado: ${m && m[0]}`);
      });
    }
  }

  await h.test('ninguna implementación resuelve rutas sin pasar por roots', () => {
    for (const file of fs.readdirSync(IMPL_DIR).filter((f) => f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(IMPL_DIR, file), 'utf-8');
      // path.resolve con una variable sería un escape del jail.
      const malo = src.match(/path\.resolve\((?!__dirname)/);
      h.equal(malo, null, `${file}: usa path.resolve fuera del jail`);
    }
  });

  h.suite('contrato :: perfiles');

  await h.test('el perfil admin NO está activo por defecto', () => {
    const { DEFAULT_POLICY } = require('../../src/core/policy/defaults');
    h.equal(DEFAULT_POLICY.profiles.includes('admin'), false);
  });

  await h.test('cada herramienta pertenece exactamente a un perfil', () => {
    for (const t of ALL_TOOLS) {
      const perfiles = Object.entries(PROFILES).filter(([, set]) => set.has(t.name));
      h.equal(perfiles.length, 1, `${t.name} está en ${perfiles.length} perfiles`);
    }
  });

  await h.test('el perfil por defecto expone una superficie acotada', () => {
    const { DEFAULT_POLICY } = require('../../src/core/policy/defaults');
    const n = DEFAULT_POLICY.profiles.reduce((acc, p) => acc + (PROFILES[p] ? PROFILES[p].size : 0), 0);
    h.ok(n <= 18, `se exponen ${n} herramientas por defecto`);
  });

  h.suite('contrato :: compatibilidad con nombres v1');

  await h.test('todas las herramientas v1 tienen alias o retirada documentada', () => {
    const v1 = [
      'get_agent_protocol', 'list_pending_tasks', 'resume_task_session', 'save_or_update_task', 'memory_bank',
      'take_screenshot', 'mouse_click', 'mouse_move', 'mouse_drag', 'mouse_scroll', 'type_text', 'press_hotkey',
      'get_screen_metrics', 'list_windows', 'focus_window',
      'run_command', 'run_background_command', 'get_background_task_output', 'kill_background_task',
      'list_background_tasks', 'get_environment_vars',
      'read_file', 'write_file', 'edit_file_replace', 'search_files', 'grep_in_files', 'get_directory_tree', 'file_operations',
      'save_context_checkpoint', 'load_context_checkpoint', 'list_context_checkpoints', 'store_memory', 'recall_memory',
      'git_status', 'git_diff', 'git_log', 'git_commit', 'git_branch',
      'get_system_health', 'list_processes', 'kill_process', 'open_app_or_url',
      'fetch_web_page', 'check_port', 'http_request',
    ];
    h.equal(v1.length, 45, 'la lista v1 debe tener las 45 herramientas auditadas');
    const faltan = v1.filter((n) => !LEGACY_ALIASES[n]);
    h.equal(faltan.length, 0, `sin migración documentada: ${faltan.join(', ')}`);
  });

  await h.test('los alias apuntan a herramientas que existen (o a null si se retiraron)', () => {
    for (const [v1name, alias] of Object.entries(LEGACY_ALIASES)) {
      if (alias.tool === null) {
        h.ok(alias.note, `${v1name} retirada sin explicación`);
      } else {
        h.ok(BY_NAME.has(alias.tool), `${v1name} apunta a ${alias.tool}, que no existe`);
      }
    }
  });

  await h.test('los args por defecto de los alias son válidos para el destino', () => {
    for (const [v1name, alias] of Object.entries(LEGACY_ALIASES)) {
      if (!alias.tool || !alias.args) continue;
      const def = BY_NAME.get(alias.tool);
      for (const [k, v] of Object.entries(alias.args)) {
        const prop = def.inputSchema.properties[k];
        h.ok(prop, `${v1name}: '${k}' no existe en ${alias.tool}`);
        if (prop.enum) h.ok(prop.enum.includes(v), `${v1name}: '${v}' no es válido para ${alias.tool}.${k}`);
      }
    }
  });

  h.suite('contrato :: los esquemas se pueden serializar y son JSON Schema válido-ish');

  await h.test('toMcpTool produce JSON serializable', () => {
    const json = JSON.stringify({ tools: ALL_TOOLS.map(toMcpTool) });
    h.ok(json.length > 1000);
    h.equal(JSON.parse(json).tools.length, ALL_TOOLS.length);
  });

  await h.test('el validador rechaza propiedades no declaradas', () => {
    const errores = validate(BY_NAME.get('workspace.read').inputSchema, { paths: ['x'], inventado: 1 });
    h.ok(errores.length >= 1);
    h.includes(errores[0], 'no declarada');
  });

  await h.test('el validador exige los campos obligatorios', () => {
    const errores = validate(BY_NAME.get('workspace.read').inputSchema, {});
    h.includes(errores.join(' '), 'obligatorio');
  });

  await h.test('el validador aplica enum, patrón y límites', () => {
    const s = BY_NAME.get('memory.checkpoint').inputSchema;
    h.ok(validate(s, { action: 'inventada', project_id: 'p' }).length >= 1, 'enum no aplicado');
    h.ok(validate(s, { action: 'create', project_id: 'con espacios' }).length >= 1, 'patrón no aplicado');
    h.ok(validate(s, { action: 'create', project_id: 'p', title: 'x'.repeat(400) }).length >= 1, 'maxLength no aplicado');
  });
}

if (require.main === module) {
  run().then(() => h.exitWithSummary('CONTRATO :: CATÁLOGO'));
}
module.exports = { run };
