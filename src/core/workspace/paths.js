'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { GhostError, CODES } = require('../errors');

const isWindows = process.platform === 'win32';

/* -------------------------------------------------------------------------- */
/* Exclusiones sensibles                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Rutas y nombres prohibidos INCLUSO dentro de una raíz autorizada.
 * Se comparan sobre la ruta canónica en minúsculas con separadores '/'.
 */
const DENY_BASENAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.npmrc',
  '.netrc',
  '_netrc',
  '.pypirc',
  '.git-credentials',
  '.htpasswd',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials',
  'secrets.json',
  'shadow',
  'sam',
]);

const DENY_EXTENSIONS = new Set(['.pem', '.key', '.pfx', '.p12', '.jks', '.keystore', '.ppk', '.asc', '.gpg']);

/** Segmentos de directorio prohibidos en cualquier posición. */
const DENY_SEGMENTS = new Set([
  '.ssh',
  '.aws',
  '.gnupg',
  '.gpg',
  '.docker',
  '.kube',
  '.azure',
  '.config/gcloud',
]);

/** Prefijos absolutos prohibidos, aunque una raíz mal configurada los incluyera. */
function systemDenyPrefixes() {
  const list = [];
  if (isWindows) {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    list.push(sysRoot, 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData\\Microsoft');
    if (process.env.APPDATA) list.push(path.join(process.env.APPDATA, 'Microsoft', 'Crypto'));
  } else {
    list.push('/etc', '/boot', '/dev', '/proc', '/sys', '/var/run', '/root');
  }
  return list.map(canonicalize);
}

/* -------------------------------------------------------------------------- */
/* Normalización                                                               */
/* -------------------------------------------------------------------------- */

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function canonicalize(p) {
  // Forma comparable: separadores '/', sin barra final, minúsculas en Windows.
  let out = path.resolve(p).replace(/[\\/]+/g, '/');
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return isWindows ? out.toLowerCase() : out;
}

function isInside(child, parent) {
  const c = canonicalize(child);
  const p = canonicalize(parent);
  return c === p || c.startsWith(p.endsWith('/') ? p : p + '/');
}

/**
 * Rechaza formas de ruta peligrosas ANTES de tocar el disco.
 * Se aplica a la cadena tal y como la envió el modelo.
 */
function rejectDangerousForm(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new GhostError(CODES.INVALID_ARGUMENT, 'La ruta debe ser una cadena no vacía.');
  }
  if (raw.includes('\0')) {
    throw new GhostError(CODES.PATH_DENIED, 'La ruta contiene un byte NUL.');
  }
  if (raw.length > 4096) {
    throw new GhostError(CODES.PATH_DENIED, 'Ruta demasiado larga.');
  }
  // UNC y espacios de nombres de dispositivo de Windows.
  if (/^(\\\\|\/\/)/.test(raw)) {
    throw new GhostError(CODES.PATH_DENIED, 'Las rutas UNC / de red no están permitidas.', {
      details: { form: 'unc' },
    });
  }
  if (/^\\\\[?.]\\/.test(raw) || /^[\\/]{2}[?.][\\/]/.test(raw)) {
    throw new GhostError(CODES.PATH_DENIED, 'Los espacios de nombres de dispositivo (\\\\?\\, \\\\.\\) no están permitidos.');
  }
  // Flujos de datos alternativos de NTFS: "archivo.txt:oculto".
  const withoutDrive = /^[a-zA-Z]:/.test(raw) ? raw.slice(2) : raw;
  if (withoutDrive.includes(':')) {
    throw new GhostError(CODES.PATH_DENIED, 'Los flujos de datos alternativos (ADS) no están permitidos.');
  }
  // Nombres de dispositivo reservados de Windows en cualquier segmento.
  for (const seg of raw.split(/[\\/]+/)) {
    if (seg && WIN_RESERVED.test(seg)) {
      throw new GhostError(CODES.PATH_DENIED, `Nombre de dispositivo reservado no permitido: ${seg}`);
    }
    // Nombres cortos 8.3 (PROGRA~1) evitan comparaciones por prefijo.
    if (/~\d+$/.test(seg)) {
      throw new GhostError(CODES.PATH_DENIED, `Los nombres cortos 8.3 no están permitidos: ${seg}`);
    }
  }
  return raw;
}

/**
 * Devuelve la ruta canónica real resolviendo enlaces simbólicos, junctions y
 * reparse points del ancestro existente más profundo, y añadiendo la cola inexistente.
 */
function realpathDeepest(absolute) {
  let current = path.resolve(absolute);
  const tail = [];
  // Límite de seguridad frente a rutas patológicas.
  for (let i = 0; i < 64; i++) {
    try {
      const real = fs.realpathSync.native
        ? fs.realpathSync.native(current)
        : fs.realpathSync(current);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // EACCES/EPERM: no podemos canonicalizar -> tratamos como denegado.
        throw new GhostError(CODES.PATH_DENIED, `No se puede canonicalizar la ruta: ${err.code}`, {
          details: { code: err.code },
        });
      }
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(absolute); // llegamos a la raíz
      tail.push(path.basename(current));
      current = parent;
    }
  }
  throw new GhostError(CODES.PATH_DENIED, 'Ruta demasiado profunda para canonicalizar.');
}

function violatesDenylist(canonicalPath) {
  const lower = canonicalPath; // ya viene canonicalizado (minúsculas en Windows)
  const base = lower.split('/').pop();
  if (DENY_BASENAMES.has(base)) return `nombre de archivo sensible (${base})`;
  if (base.startsWith('.env.')) return 'archivo de entorno (.env.*)';
  if (base.startsWith('id_rsa') || base.startsWith('id_ed25519')) return 'clave SSH';
  const ext = path.extname(base);
  if (DENY_EXTENSIONS.has(ext)) return `extensión sensible (${ext})`;
  const segments = lower.split('/');
  for (const seg of segments) {
    if (DENY_SEGMENTS.has(seg)) return `directorio sensible (${seg})`;
  }
  for (const denyPrefix of systemDenyPrefixes()) {
    if (isInside(lower, denyPrefix)) return `directorio de sistema (${denyPrefix})`;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Raíces autorizadas                                                          */
/* -------------------------------------------------------------------------- */

class Roots {
  /**
   * @param {Array<{name:string, path:string, write?:boolean}>} definitions
   * @param {string[]} controlPaths rutas de control de GhostPC (política, diario,
   *        aprobaciones) que nunca deben ser accesibles por herramientas de archivo.
   */
  constructor(definitions, controlPaths = []) {
    this.roots = [];
    for (const def of definitions) {
      if (!def || !def.name || !def.path) continue;
      let real;
      try {
        fs.mkdirSync(def.path, { recursive: true });
        real = fs.realpathSync.native ? fs.realpathSync.native(def.path) : fs.realpathSync(def.path);
      } catch (e) {
        real = path.resolve(def.path);
      }
      this.roots.push({
        name: def.name,
        path: real,
        canonical: canonicalize(real),
        write: def.write !== false,
      });
    }
    if (this.roots.length === 0) {
      throw new Error('GhostPC no puede arrancar sin al menos una raíz autorizada.');
    }
    this.controlCanonical = controlPaths.map(canonicalize);
  }

  list() {
    return this.roots.map((r) => ({ name: r.name, path: r.path, write: r.write }));
  }

  byName(name) {
    return this.roots.find((r) => r.name === name) || null;
  }

  /** Devuelve la raíz que contiene la ruta canónica, o null. */
  rootFor(canonicalPath) {
    let best = null;
    for (const r of this.roots) {
      if (isInside(canonicalPath, r.canonical)) {
        if (!best || r.canonical.length > best.canonical.length) best = r;
      }
    }
    return best;
  }

  /**
   * Resuelve una ruta suministrada por el modelo a una ruta absoluta segura.
   *
   * @param {string} raw ruta tal cual la envió el modelo
   * @param {object} opts
   * @param {string} [opts.root] nombre de raíz para resolver rutas relativas
   * @param {boolean} [opts.forWrite] si la operación va a escribir
   * @param {boolean} [opts.mustExist]
   * @param {boolean} [opts.allowControl] permite tocar rutas de control (uso interno)
   * @returns {{absolute:string, canonical:string, root:object, relative:string, exists:boolean}}
   */
  resolve(raw, opts = {}) {
    rejectDangerousForm(raw);

    // Nunca resolvemos contra process.cwd(): o es absoluta, o es relativa a una raíz.
    let base;
    if (path.isAbsolute(raw)) {
      base = raw;
    } else {
      const rootDef = opts.root ? this.byName(opts.root) : this.roots[0];
      if (!rootDef) {
        throw new GhostError(CODES.ROOT_UNKNOWN, `Raíz autorizada desconocida: '${opts.root}'.`, {
          details: { available: this.roots.map((r) => r.name) },
        });
      }
      base = path.join(rootDef.path, raw);
    }

    const real = realpathDeepest(base);
    const canonical = canonicalize(real);

    const root = this.rootFor(canonical);
    if (!root) {
      throw new GhostError(
        CODES.PATH_OUTSIDE_ROOT,
        'La ruta queda fuera de todas las raíces autorizadas.',
        {
          remediation: 'Usa una ruta dentro de una raíz autorizada. El agente no puede ampliar las raíces.',
          details: { roots: this.roots.map((r) => r.name) },
        }
      );
    }

    // Si la ruta literal estaba dentro de una raíz pero la ruta REAL no coincide con
    // la literal, hubo un enlace/junction por el camino. Sólo se acepta si el destino
    // sigue dentro de una raíz (ya comprobado) y además el enlace no cruza raíces.
    const literalCanonical = canonicalize(base);
    if (literalCanonical !== canonical) {
      const literalRoot = this.rootFor(literalCanonical);
      if (!literalRoot || literalRoot.name !== root.name) {
        throw new GhostError(
          CODES.PATH_LINK_ESCAPE,
          'La ruta atraviesa un enlace simbólico o junction que cambia de raíz autorizada.',
          { details: { requestedRoot: literalRoot ? literalRoot.name : null, actualRoot: root.name } }
        );
      }
    }

    if (!opts.allowControl) {
      for (const ctrl of this.controlCanonical) {
        if (isInside(canonical, ctrl)) {
          throw new GhostError(
            CODES.PATH_DENIED,
            'Las rutas de control de GhostPC (política, diario, aprobaciones) no son accesibles por herramientas.',
            { details: { control: ctrl } }
          );
        }
      }
      const denyReason = violatesDenylist(canonical);
      if (denyReason) {
        throw new GhostError(CODES.PATH_DENIED, `Ruta excluida por política: ${denyReason}.`, {
          details: { reason: denyReason },
        });
      }
    }

    if (opts.forWrite && !root.write) {
      throw new GhostError(CODES.PATH_DENIED, `La raíz '${root.name}' es de sólo lectura.`);
    }

    const exists = fs.existsSync(real);
    if (opts.mustExist && !exists) {
      throw new GhostError(CODES.PATH_NOT_FOUND, 'La ruta no existe.', {
        recoverable: true,
        details: { relative: path.relative(root.path, real) },
      });
    }

    return {
      absolute: real,
      canonical,
      root,
      relative: path.relative(root.path, real).replace(/\\/g, '/'),
      exists,
    };
  }

  /** Igual que resolve() pero devuelve null en lugar de lanzar. Útil en filtros. */
  tryResolve(raw, opts = {}) {
    try {
      return this.resolve(raw, opts);
    } catch (e) {
      return null;
    }
  }
}

/** Raíces por defecto derivadas del entorno. Nunca las puede ampliar el modelo. */
function defaultRootDefinitions(env = process.env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const spec = env.GHOSTPC_ROOTS;
  if (spec) {
    return spec
      .split(',')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        // formato:  nombre=ruta[:ro]
        const eq = chunk.indexOf('=');
        if (eq < 0) return { name: path.basename(chunk), path: chunk, write: true };
        const name = chunk.slice(0, eq).trim();
        let p = chunk.slice(eq + 1).trim();
        let write = true;
        if (p.endsWith('|ro')) {
          write = false;
          p = p.slice(0, -3);
        }
        return { name, path: p, write };
      });
  }
  const ws = env.CHATGPT_WORKSPACE || path.join(home, 'ChatGPT-Workspace');
  return [{ name: 'workspace', path: ws, write: true }];
}

module.exports = {
  Roots,
  defaultRootDefinitions,
  canonicalize,
  isInside,
  rejectDangerousForm,
  realpathDeepest,
  violatesDenylist,
  DENY_BASENAMES,
  DENY_EXTENSIONS,
  DENY_SEGMENTS,
};
