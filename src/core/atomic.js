'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Escritura atómica y utilidades de recuperación.
 *
 * Regla: nunca se escribe directamente sobre el archivo de destino. Se escribe
 * en un temporal del MISMO directorio (para que el rename sea atómico dentro
 * del mismo volumen), se hace fsync y luego rename.
 *
 * Si el proceso muere a mitad, el destino conserva su contenido anterior íntegro
 * y queda un `.tmp` huérfano que `sweepTemp()` limpia al arrancar.
 */

const TMP_SUFFIX = '.ghostpc-tmp';

function writeFileAtomic(target, data, encoding = 'utf-8') {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${crypto.randomBytes(4).toString('hex')}${TMP_SUFFIX}`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeSync(fd, data, 0, typeof data === 'string' ? undefined : data.length, null);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, target);
  } catch (err) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (e) { /* ignorado */ }
    }
    try { fs.unlinkSync(tmp); } catch (e) { /* ignorado */ }
    throw err;
  }
  // fsync del directorio para que el rename sobreviva a un corte de corriente.
  try {
    const dfd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dfd); } catch (e) { /* no soportado en Windows: aceptable */ }
    fs.closeSync(dfd);
  } catch (e) {
    /* no soportado: aceptable */
  }
  return target;
}

function writeJsonAtomic(target, obj) {
  return writeFileAtomic(target, JSON.stringify(obj, null, 2), 'utf-8');
}

function readJsonSafe(file, fallback = null) {
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, value: fallback, missing: true };
    // JSON corrupto: NO se silencia. El llamante decide.
    return { ok: false, value: fallback, error: err.message, corrupt: err instanceof SyntaxError };
  }
}

/** Elimina temporales huérfanos de una caída anterior. */
function sweepTemp(dir) {
  let removed = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(TMP_SUFFIX)) {
        try {
          fs.unlinkSync(p);
          removed++;
        } catch (err) { /* ignorado */ }
      }
    }
  };
  walk(dir);
  return removed;
}

function sha256File(file) {
  const buf = fs.readFileSync(file);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

/* -------------------------------------------------------------------------- */
/* Bloqueos / leases                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Lease de exclusión mutua basado en un directorio (mkdir es atómico en todos
 * los SO). Incluye caducidad para que la caída de un proceso no deje el recurso
 * bloqueado para siempre.
 */
class Lease {
  constructor(lockDir, { ttlMs = 30_000, owner = 'unknown' } = {}) {
    this.lockDir = lockDir;
    this.ttlMs = ttlMs;
    this.owner = owner;
    this.metaFile = path.join(lockDir, 'owner.json');
    this.held = false;
  }

  _readMeta() {
    try {
      return JSON.parse(fs.readFileSync(this.metaFile, 'utf-8'));
    } catch (e) {
      return null;
    }
  }

  /** @returns {{acquired:boolean, heldBy?:string, expiresAt?:string}} */
  tryAcquire() {
    fs.mkdirSync(path.dirname(this.lockDir), { recursive: true });
    try {
      fs.mkdirSync(this.lockDir);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const meta = this._readMeta();
      const expired = !meta || !meta.expires_at || Date.parse(meta.expires_at) < Date.now();
      if (!expired) {
        return { acquired: false, heldBy: meta.owner, expiresAt: meta.expires_at };
      }
      // Lease caducado: se reclama.
      try {
        fs.rmSync(this.lockDir, { recursive: true, force: true });
        fs.mkdirSync(this.lockDir);
      } catch (e) {
        return { acquired: false, heldBy: meta && meta.owner, expiresAt: meta && meta.expires_at };
      }
    }
    writeJsonAtomic(this.metaFile, {
      owner: this.owner,
      pid: process.pid,
      acquired_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + this.ttlMs).toISOString(),
    });
    this.held = true;
    return { acquired: true };
  }

  release() {
    if (!this.held) return false;
    try {
      fs.rmSync(this.lockDir, { recursive: true, force: true });
    } catch (e) {
      return false;
    }
    this.held = false;
    return true;
  }
}

/** Ejecuta `fn` con el lease tomado; siempre lo libera. */
async function withLease(lockDir, opts, fn) {
  const lease = new Lease(lockDir, opts);
  const res = lease.tryAcquire();
  if (!res.acquired) return { acquired: false, heldBy: res.heldBy, expiresAt: res.expiresAt };
  try {
    const value = await fn();
    return { acquired: true, value };
  } finally {
    lease.release();
  }
}

module.exports = {
  writeFileAtomic,
  writeJsonAtomic,
  readJsonSafe,
  sweepTemp,
  sha256File,
  sha256Text,
  Lease,
  withLease,
  TMP_SUFFIX,
};
