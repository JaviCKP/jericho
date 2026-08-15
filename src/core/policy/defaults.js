'use strict';

/**
 * Política POR DEFECTO de GhostPC.
 *
 * Esto es la parte INMUTABLE: se compila con el servidor y no la puede cambiar
 * ningún contenido obtenido con herramientas. El archivo de política en disco
 * (data/control/policy.json) sólo puede AJUSTAR estos valores dentro de los
 * límites que marca `HARD_CEILINGS`, y sólo lo edita una persona.
 */

const DEFAULT_POLICY = {
  schema_version: 1,

  /** Perfiles activos. */
  profiles: ['core_read', 'development', 'desktop'],

  /** Riesgo máximo permitido en ningún caso. R4 exige activarlo explícitamente. */
  max_risk: 'R3',

  /** Sesiones anónimas (sin session_id explícito) quedan limitadas. */
  anonymous_max_risk: 'R1',

  approval: {
    required_at_or_above: 'R2',
    ttl_minutes: 15,
    /**
     * Concesiones permanentes definidas por la persona: evitan confirmaciones
     * rutinarias. Cada una acota herramienta, riesgo máximo y ámbito.
     */
    standing_grants: [
      {
        tools: ['workspace.apply_patch', 'workspace.write', 'memory.checkpoint', 'git.commit'],
        max_risk: 'R1',
        reason: 'Cambios reversibles dentro del proyecto con parche atómico e historial.',
      },
      {
        tools: ['terminal.exec', 'verify.run'],
        max_risk: 'R1',
        reason: 'Comandos de la allowlist de compilación y pruebas dentro del proyecto.',
      },
      {
        tools: ['web.fetch_readonly', 'http.call_allowlisted'],
        max_risk: 'R2',
        methods: ['GET', 'HEAD'],
        reason: 'Lecturas de red hacia destinos ya autorizados en la allowlist.',
      },
      {
        tools: ['desktop.observe', 'desktop.element_action'],
        max_risk: 'R2',
        reason:
          'Observación por ventana y clics con coordenadas RELATIVAS a una ventana verificada. ' +
          'El control es la precondición (ventana, título y geometría deben coincidir con una observación ' +
          'reciente), no una confirmación por clic: pedirla en cada clic llevaría a desactivar las ' +
          'aprobaciones por fatiga. Escribir texto sigue siendo R3 y sí requiere aprobación.',
      },
      {
        tools: ['terminal.exec', 'verify.run'],
        max_risk: 'R3',
        requires_preauthorized_secrets: true,
        reason:
          'Inyectar en un proceso un secreto que la persona ya añadió a secrets.allowed. ' +
          'La autorización es esa lista; el valor nunca vuelve al modelo y la salida va redactada.',
      },
    ],
  },

  limits: {
    exec: {
      timeout_ms: 120_000,
      max_output_bytes: 200_000,
      max_concurrent: 4,
      background_ttl_ms: 30 * 60 * 1000,
      max_background: 8,
    },
    net: {
      timeout_ms: 15_000,
      max_response_bytes: 2_000_000,
      max_request_bytes: 65_536,
      max_redirects: 3,
    },
    patch: { max_files: 25, max_bytes: 1_000_000 },
    output: { max_chars: 30_000 },
    memory: { max_work_items: 2000, resume_budget_chars: 12_000 },
    desktop: {
      max_actions_without_observation: 3,
      observation_max_age_ms: 5_000,
      max_capture_pixels: 2_400_000,
    },
  },

  exec: {
    /** Sólo estos programas. No hay shell libre. */
    allowed_programs: [
      'node', 'npm', 'npx', 'pnpm', 'yarn',
      'git',
      'python', 'python3', 'pip', 'pytest',
      'tsc', 'jest', 'vitest', 'eslint', 'prettier',
      'go', 'cargo', 'rustc',
      'dotnet', 'java', 'mvn', 'gradle',
      'make',
      'powershell', 'powershell.exe', 'pwsh',
      'notepad', 'explorer', 'code',
    ],
    /** Subcomandos prohibidos por programa (aunque el programa esté permitido). */
    denied_subcommands: {
      git: ['push', 'remote', 'submodule', 'clean', 'reset', 'filter-branch', 'gc', 'config'],
      npm: ['publish', 'login', 'adduser', 'token', 'config', 'unpublish'],
      pnpm: ['publish', 'login'],
      yarn: ['publish', 'login'],
      pip: ['config'],
    },
    /** Nunca se pasa una cadena de shell: siempre programa + argv. */
    shell: false,
    /** Variables de entorno que se propagan al hijo. El resto NO se hereda. */
    env_passthrough: [
      'PATH', 'Path', 'SystemRoot', 'windir', 'COMSPEC', 'PATHEXT',
      'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
      'LANG', 'LC_ALL', 'TZ', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
      'NODE_ENV', 'CI', 'FORCE_COLOR', 'TERM',
      'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMDATA', 'SYSTEMDRIVE',
    ],
  },

  network: {
    /**
     * Destinos con alias. El modelo NO envía URLs libres a http.call_allowlisted:
     * envía un alias + ruta.
     */
    destinations: [
      { alias: 'npm', origin: 'https://registry.npmjs.org', methods: ['GET', 'HEAD'] },
      { alias: 'pypi', origin: 'https://pypi.org', methods: ['GET', 'HEAD'] },
      { alias: 'github_api', origin: 'https://api.github.com', methods: ['GET'] },
      { alias: 'mdn', origin: 'https://developer.mozilla.org', methods: ['GET'] },
      { alias: 'nodejs_docs', origin: 'https://nodejs.org', methods: ['GET'] },
    ],
    /** web.fetch_readonly acepta https:// público con estas restricciones. */
    fetch_readonly: {
      enabled: true,
      schemes: ['https:'],
      block_private: true,
    },
    allow_private: false,
    allow_loopback: false,
    /** Enviar datos LEÍDOS DEL EQUIPO hacia fuera exige aprobación explícita. */
    egress_requires_approval: true,
    egress_free_bytes: 0,
  },

  secrets: {
    /** Nombres que el SecretBroker puede inyectar en un proceso. Vacío = ninguno. */
    allowed: [],
    /** Invariante no configurable: nunca se devuelve un valor al modelo. */
    never_return_values: true,
  },

  git: {
    allow_remote_operations: false, // push/fetch/pull -> R3, desactivado
    allow_history_rewrite: false,
    require_clean_tree_for_commit: false,
  },

  desktop: {
    require_window_precondition: true,
    allow_typing_secrets: false,
  },

  /**
   * Acciones administrativas predefinidas. Vacío por defecto.
   * Cada entrada es {action_id, description, program, args}: NO admite comandos
   * del modelo, sólo identificadores de acciones que ya escribió una persona.
   */
  admin: {
    actions: [],
  },

  memory: {
    require_evidence_for_completion: true,
    global_rules_require_approval: true,
  },

  audit: {
    journal_enabled: true,
    breaker_failure_threshold: 5,
    breaker_cooldown_ms: 60_000,
  },
};

/**
 * Techos absolutos: el archivo de política de disco no puede superarlos.
 * Evita que una edición descuidada (o una persona engañada) abra el sistema.
 */
const HARD_CEILINGS = {
  'limits.exec.timeout_ms': 600_000,
  'limits.exec.max_output_bytes': 2_000_000,
  'limits.exec.max_concurrent': 16,
  'limits.exec.max_background': 32,
  'limits.net.timeout_ms': 60_000,
  'limits.net.max_response_bytes': 20_000_000,
  'limits.net.max_request_bytes': 5_000_000,
  'limits.net.max_redirects': 5,
  'limits.patch.max_files': 200,
  'limits.patch.max_bytes': 10_000_000,
  'limits.output.max_chars': 200_000,
  'limits.desktop.max_actions_without_observation': 10,
  'limits.desktop.observation_max_age_ms': 30_000,
};

/** Invariantes que NINGUNA configuración puede desactivar. */
const INVARIANTS = {
  'secrets.never_return_values': true,
  'exec.shell': false,
};

module.exports = { DEFAULT_POLICY, HARD_CEILINGS, INVARIANTS };
