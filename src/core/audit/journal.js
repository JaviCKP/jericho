'use strict';

const fs = require('fs');
const path = require('path');
const { sha256, sortDeep } = require('../ids');
const redact = require('../redact');

/**
 * Diario inmutable de operaciones.
 *
 * - Sólo se añade (append-only). Nunca se reescribe una entrada.
 * - Cada entrada encadena el hash de la anterior: cualquier borrado o edición
 *   posterior rompe la cadena y `verify()` lo detecta.
 * - Todo lo que entra pasa por la capa de redacción: el diario nunca contiene
 *   valores de secretos.
 * - Vive fuera de las raíces autorizadas, así que ninguna herramienta de
 *   archivos puede tocarlo.
 */

const GENESIS = '0'.repeat(64);

class Journal {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(this.dir, { recursive: true });
    this.headFile = path.join(this.dir, 'HEAD');
    this.prevHash = this._loadHead();
  }

  _loadHead() {
    try {
      const v = fs.readFileSync(this.headFile, 'utf-8').trim();
      if (/^[0-9a-f]{64}$/.test(v)) return v;
    } catch (e) {
      /* primera ejecución */
    }
    return GENESIS;
  }

  _fileFor(date) {
    const d = date || new Date();
    const day = d.toISOString().slice(0, 10);
    return path.join(this.dir, `journal-${day}.jsonl`);
  }

  /**
   * Añade una entrada. Devuelve la entrada escrita (ya redactada).
   * Es síncrono a propósito: si el proceso muere justo después de una operación
   * peligrosa, el registro ya está en disco.
   */
  append(entry) {
    const now = new Date();
    const body = redact.redactValue({
      ts: now.toISOString(),
      ...entry,
    });
    const withChain = { ...body, prev_hash: this.prevHash };
    const hash = sha256(JSON.stringify(sortDeep(withChain)));
    const full = { ...withChain, hash };

    const file = this._fileFor(now);
    const line = JSON.stringify(full) + '\n';
    if (!this._write(file, line)) {
      // Reintento tras recrear el directorio (puede haberse borrado por fuera).
      try {
        fs.mkdirSync(this.dir, { recursive: true });
      } catch (e) { /* se reporta abajo */ }
      if (!this._write(file, line)) {
        // Un fallo de auditoría es grave, pero tumbar el servidor lo es más:
        // se marca, se avisa por stderr y se sigue. `verify()` lo detectará.
        this.writeFailures = (this.writeFailures || 0) + 1;
        this.lastWriteError = new Date().toISOString();
        process.stderr.write(
          `[GhostPC] FALLO AL ESCRIBIR EL DIARIO DE AUDITORÍA (${this.writeFailures} veces). ` +
            `La cadena quedará incompleta: revisa ${this.dir}\n`
        );
        return full;
      }
    }

    // HEAD se actualiza de forma atómica para poder recuperar la cadena tras una caída.
    try {
      const tmp = this.headFile + '.tmp';
      fs.writeFileSync(tmp, hash, 'utf-8');
      fs.renameSync(tmp, this.headFile);
    } catch (e) {
      process.stderr.write(`[GhostPC] No se pudo actualizar HEAD del diario: ${e.code}\n`);
    }
    this.prevHash = hash;
    return full;
  }

  _write(file, line) {
    let fd;
    try {
      fd = fs.openSync(file, 'a');
      fs.writeSync(fd, line);
      fs.fsyncSync(fd);
      return true;
    } catch (e) {
      return false;
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch (e) { /* ignorado */ }
      }
    }
  }

  /** Lee todas las entradas en orden cronológico. */
  readAll() {
    const files = fs
      .readdirSync(this.dir)
      .filter((f) => f.startsWith('journal-') && f.endsWith('.jsonl'))
      .sort();
    const out = [];
    for (const f of files) {
      const text = fs.readFileSync(path.join(this.dir, f), 'utf-8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          out.push(JSON.parse(line));
        } catch (e) {
          out.push({ __corrupt: true, raw: line.slice(0, 200) });
        }
      }
    }
    return out;
  }

  /** Últimas N entradas (para el panel de actividad reciente). */
  tail(n = 50, filter = null) {
    const all = this.readAll();
    const filtered = filter ? all.filter(filter) : all;
    return filtered.slice(-n);
  }

  /**
   * Verifica la cadena de hashes completa.
   * @returns {{valid:boolean, entries:number, brokenAt:number|null, reason:string|null}}
   */
  verify() {
    const all = this.readAll();
    let prev = GENESIS;
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      if (e.__corrupt) {
        return { valid: false, entries: all.length, brokenAt: i, reason: 'línea corrupta' };
      }
      if (e.prev_hash !== prev) {
        return { valid: false, entries: all.length, brokenAt: i, reason: 'prev_hash no encadena' };
      }
      const { hash, ...rest } = e;
      const expected = sha256(JSON.stringify(sortDeep(rest)));
      if (expected !== hash) {
        return { valid: false, entries: all.length, brokenAt: i, reason: 'hash no coincide (entrada alterada)' };
      }
      prev = hash;
    }
    return { valid: true, entries: all.length, brokenAt: null, reason: null };
  }

  /** Exporta el diario para revisión externa. */
  export(targetFile, { from = null, to = null } = {}) {
    const all = this.readAll().filter((e) => {
      if (from && e.ts < from) return false;
      if (to && e.ts > to) return false;
      return true;
    });
    const payload = {
      exported_at: new Date().toISOString(),
      chain: this.verify(),
      entries: all,
    };
    fs.writeFileSync(targetFile, JSON.stringify(payload, null, 2), 'utf-8');
    return { file: targetFile, entries: all.length, chain_valid: payload.chain.valid };
  }
}

module.exports = { Journal, GENESIS };
