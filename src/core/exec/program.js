'use strict';

const fs = require('fs');
const path = require('path');
const { JerichoError, CODES } = require('../errors');

const isWindows = process.platform === 'win32';

// La terminal del agente no es una consola general.  Hasta que exista un
// registro de action_id firmado por el operador, estos lanzadores quedan
// bloqueados de forma permanente (incluidos sus alias y wrappers .cmd).
const GENERIC_EXECUTABLES = new Set([
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'python', 'python3', 'pip', 'pytest',
  'tsc', 'jest', 'vitest', 'eslint', 'prettier', 'go', 'cargo', 'rustc',
  'dotnet', 'java', 'mvn', 'gradle', 'make', 'git', 'cmd', 'powershell',
  'pwsh', 'sh', 'bash', 'zsh', 'fish', 'wsl', 'busybox', 'deno', 'bun',
]);

/**
 * Resolución y validación de programas y argumentos.
 *
 * REGLA: nunca se construye una cadena de shell. Siempre programa + argv.
 * El nombre del programa debe ser un nombre desnudo de la allowlist (sin rutas),
 * y cada argumento se valida contra metacaracteres antes de pasar a spawn.
 */

/**
 * Metacaracteres que cmd.exe REINTERPRETA.
 *
 * Sólo se prohíben cuando el destino es un lanzador .cmd/.bat de Windows
 * (npm, npx, tsc…): en ese caso Windows obliga a pasar por cmd.exe y la línea
 * se vuelve a analizar, así que un `&` encadenaría un comando nuevo.
 *
 * Al ejecutar un .exe directamente (node, git, python) NO interviene ningún
 * shell: Node entrega el argv por CreateProcess con el entrecomillado correcto
 * y estos caracteres viajan literales. Prohibirlos ahí rompería usos legítimos
 * —un mensaje de commit con comillas, una expresión con `&&`— sin ganar nada.
 */
const FORBIDDEN_ARG_CHARS = /[&|<>^"`\r\n\0%!]/;

/** Caracteres de control inaceptables en cualquier caso (NUL incluido). */
function hasControlChars(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0 || (c >= 1 && c <= 8) || c === 11 || c === 12 || (c >= 14 && c <= 31)) return true;
  }
  return false;
}

function validateArg(arg, index, opts) {
  const strict = !!(opts && opts.strict);
  if (typeof arg !== 'string') {
    throw new JerichoError(CODES.INVALID_ARGUMENT, `El argumento ${index} debe ser una cadena.`);
  }
  if (arg.length > 4096) {
    throw new JerichoError(CODES.INVALID_ARGUMENT, `El argumento ${index} es demasiado largo.`);
  }
  if (hasControlChars(arg)) {
    throw new JerichoError(CODES.COMMAND_NOT_ALLOWED, `El argumento ${index} contiene caracteres de control no permitidos.`);
  }
  if (strict) {
    const bad = arg.match(FORBIDDEN_ARG_CHARS);
    if (bad) {
      throw new JerichoError(
        CODES.COMMAND_NOT_ALLOWED,
        `El argumento ${index} contiene ${JSON.stringify(bad[0])}, que cmd.exe reinterpretaría al invocar este lanzador .cmd/.bat.`,
        {
          details: { argument_index: index, reason: 'windows_cmd_shim' },
          remediation:
            'Ese programa es un lanzador .cmd de Windows y obliga a pasar por cmd.exe. ' +
            'Reformula el argumento sin metacaracteres, o invoca el ejecutable real (por ejemplo `node` en vez de `npx`).',
        }
      );
    }
  }
  return arg;
}

function validateArgs(args = [], opts = {}) {
  if (!Array.isArray(args)) {
    throw new JerichoError(CODES.INVALID_ARGUMENT, 'args debe ser una lista de cadenas.');
  }
  if (args.length > 64) {
    throw new JerichoError(CODES.LIMIT_EXCEEDED, 'Demasiados argumentos (máx. 64).');
  }
  return args.map((a, i) => validateArg(a, i, opts));
}

/** Busca el ejecutable real en PATH respetando PATHEXT en Windows. */
function findOnPath(name, env = process.env) {
  const pathVar = env.PATH || env.Path || '';
  const dirs = pathVar.split(path.delimiter).filter(Boolean);
  const exts = isWindows
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        const st = fs.statSync(candidate);
        if (st.isFile()) return candidate;
      } catch (e) {
        /* siguiente candidato */
      }
    }
  }
  return null;
}

/**
 * @returns {{name:string, executable:string, isBatch:boolean}}
 */
function resolveProgram(name, policyExec, env = process.env) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new JerichoError(CODES.INVALID_ARGUMENT, 'Debes indicar el programa a ejecutar.');
  }
  if (/[\\/]/.test(name) || path.isAbsolute(name)) {
    throw new JerichoError(
      CODES.COMMAND_NOT_ALLOWED,
      'El programa debe ser un nombre de la allowlist, no una ruta.',
      { details: { received: name }, remediation: `Programas permitidos: ${policyExec.allowed_programs.join(', ')}` }
    );
  }
  if (FORBIDDEN_ARG_CHARS.test(name)) {
    throw new JerichoError(CODES.COMMAND_NOT_ALLOWED, 'El nombre del programa contiene caracteres no permitidos.');
  }

  const bare = name.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '');
  if (GENERIC_EXECUTABLES.has(bare)) {
    throw new JerichoError(
      CODES.COMMAND_NOT_ALLOWED,
      `La ejecuciÃ³n genÃ©rica de '${bare}' estÃ¡ desactivada: requiere un action_id definido fuera del repositorio.`,
      {
        details: { program: bare, reason: 'generic_process_disabled' },
        remediation: 'Usa una acciÃ³n operator-defined; no se aceptan intÃ©rpretes, package managers, shells ni Git genÃ©rico.',
      }
    );
  }
  if (!policyExec.allowed_programs.map((p) => p.toLowerCase()).includes(bare)) {
    throw new JerichoError(
      CODES.COMMAND_NOT_ALLOWED,
      `El programa '${name}' no está en la allowlist de ejecución.`,
      {
        details: { allowed: policyExec.allowed_programs },
        remediation:
          'Una persona debe añadirlo a exec.allowed_programs en data/control/policy.json. ' +
          'Jericho no expone una terminal general.',
      }
    );
  }

  const executable = findOnPath(bare, env) || (isWindows ? findOnPath(name, env) : null);
  if (!executable) {
    throw new JerichoError(CODES.COMMAND_NOT_ALLOWED, `El programa '${bare}' está permitido pero no se encuentra en PATH.`, {
      recoverable: true,
    });
  }
  const isBatch = /\.(cmd|bat)$/i.test(executable);

  // Si el lanzador .cmd tiene un equivalente en JavaScript (npm, npx, yarn…),
  // se ejecuta con `node <cli.js>` y cmd.exe queda FUERA del circuito por
  // completo. Es más seguro que entrecomillar para cmd, y además evita el
  // clásico fallo con rutas que contienen espacios ("C:\Program Files\…").
  if (isBatch) {
    const jsEntry = findNodeCliEntry(bare, executable);
    if (jsEntry) {
      return { name: bare, executable: process.execPath, isBatch: false, prependArgs: [jsEntry], viaNode: true };
    }
  }
  return { name: bare, executable, isBatch, prependArgs: [] };
}

/** Localiza el .js de un lanzador de Node instalado como .cmd en Windows. */
function findNodeCliEntry(bare, cmdPath) {
  const dir = path.dirname(cmdPath);
  const candidates = {
    npm: ['node_modules/npm/bin/npm-cli.js'],
    npx: ['node_modules/npm/bin/npx-cli.js'],
    yarn: ['node_modules/yarn/bin/yarn.js'],
    pnpm: ['node_modules/pnpm/bin/pnpm.cjs'],
  }[bare];
  if (!candidates) return null;
  for (const rel of candidates) {
    const p = path.join(dir, ...rel.split('/'));
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch (e) { /* siguiente candidato */ }
  }
  return null;
}

/** Comprueba los subcomandos prohibidos por programa. */
function assertSubcommandAllowed(program, args, policyExec) {
  const denied = (policyExec.denied_subcommands || {})[program];
  if (!denied || !denied.length) return;
  const deniedSet = new Set(denied.map((d) => d.toLowerCase()));
  // Las opciones no pueden ocultar una operaciÃ³n prohibida: se comprueban
  // tokens, formas --opciÃ³n=valor y el subcomando posterior a `--`.
  const candidates = [];
  for (const arg of args) {
    const token = String(arg).toLowerCase();
    const bare = token.replace(/^-+/, '');
    candidates.push(bare.split('=', 1)[0]);
    if (token === '--') continue;
  }
  const sub = candidates.find((candidate) => deniedSet.has(candidate));
  if (sub) {
    throw new JerichoError(
      CODES.COMMAND_NOT_ALLOWED,
      `'${program} ${sub}' está prohibido por política.`,
      {
        details: { program, subcommand: sub, denied },
        remediation:
          program === 'git'
            ? 'Las operaciones Git contra remotos o que reescriben historia son R3 y usan git.* con aprobación.'
            : 'Una persona debe revisar exec.denied_subcommands en la política.',
      }
    );
  }
}

/** Entorno mínimo para el hijo: NO se hereda process.env completo. */
function buildChildEnv(policyExec, extra = {}, parentEnv = process.env) {
  const env = {};
  for (const key of policyExec.env_passthrough || []) {
    if (parentEnv[key] !== undefined) env[key] = parentEnv[key];
  }
  // El directorio de Node siempre disponible para que 'node' resuelva.
  const nodeDir = path.dirname(process.execPath);
  const sep = path.delimiter;
  const currentPath = env.PATH || env.Path || '';
  const merged = currentPath.includes(nodeDir) ? currentPath : `${nodeDir}${sep}${currentPath}`;
  env.PATH = merged;
  if (isWindows) env.Path = merged;
  // Marcador para que los procesos hijos sepan que los lanzó Jericho.
  env.JERICHO_MANAGED = '1';
  return { ...env, ...extra };
}

module.exports = {
  resolveProgram,
  validateArgs,
  validateArg,
  assertSubcommandAllowed,
  buildChildEnv,
  findOnPath,
  FORBIDDEN_ARG_CHARS,
};
