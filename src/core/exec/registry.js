'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { JerichoError, CODES } = require('../errors');
const { writeJsonAtomic, readJsonSafe } = require('../atomic');
const { newProcId } = require('../ids');

const isWindows = process.platform === 'win32';

/**
 * Registro de procesos lanzados por Jericho.
 *
 * Resuelve tres problemas concretos del prototipo:
 *  1. El Map en memoria se perdía al reiniciar y dejaba procesos huérfanos vivos.
 *     -> Ahora se persiste en disco y hay `recoverOrphans()` al arrancar.
 *  2. Los ids se reutilizaban tras reiniciar.
 *     -> Ahora son ids con marca temporal + aleatoriedad, nunca un contador.
 *  3. Se mataba por PID sin comprobar propiedad, y el SO reutiliza PIDs.
 *     -> Ahora sólo se mata un proceso cuya identidad (PID + hora de inicio)
 *        coincide con la registrada. Si no se puede verificar, NO se mata.
 */

class ProcessRegistry {
  constructor(stateFile, { journal = null } = {}) {
    this.stateFile = stateFile;
    this.journal = journal;
    this.live = new Map(); // proc_id -> { ...record, child }
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  }

  _persist() {
    const records = [...this.live.values()].map(({ child, ...rest }) => rest);
    writeJsonAtomic(this.stateFile, { updated_at: new Date().toISOString(), processes: records });
  }

  /** Hora de inicio del proceso, para distinguir un PID reutilizado. */
  static processStartTime(pid) {
    try {
      if (isWindows) {
        const out = execFileSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command',
            `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`],
          { encoding: 'utf-8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }
        );
        const v = out.trim();
        return v || null;
      }
      const stat = fs.readFileSync(`/proc/${Number(pid)}/stat`, 'utf-8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return fields[19] || null; // starttime en jiffies desde el arranque
    } catch (e) {
      return null;
    }
  }

  static isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return e.code === 'EPERM';
    }
  }

  register({ child, program, args, cwd, sessionId, projectId, traceId, ttlMs, background }) {
    const procId = newProcId();
    const record = {
      proc_id: procId,
      pid: child.pid,
      program,
      args,
      cwd,
      session_id: sessionId || null,
      project_id: projectId || null,
      trace_id: traceId || null,
      background: !!background,
      started_at: new Date().toISOString(),
      os_start_time: ProcessRegistry.processStartTime(child.pid),
      ttl_ms: ttlMs,
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
      status: 'RUNNING',
      exit_code: null,
      owner: 'jericho',
    };
    this.live.set(procId, { ...record, child });
    this._persist();
    if (this.journal) {
      this.journal.append({
        kind: 'process.started',
        proc_id: procId,
        pid: child.pid,
        program,
        args,
        cwd,
        session_id: record.session_id,
        trace_id: record.trace_id,
      });
    }
    return procId;
  }

  markExit(procId, code) {
    const rec = this.live.get(procId);
    if (!rec) return;
    rec.status = code === null ? 'KILLED' : `EXITED`;
    rec.exit_code = code;
    rec.ended_at = new Date().toISOString();
    this._persist();
    if (this.journal) {
      this.journal.append({ kind: 'process.exited', proc_id: procId, pid: rec.pid, exit_code: code });
    }
  }

  get(procId, { sessionId = null } = {}) {
    const rec = this.live.get(procId);
    if (!rec) {
      throw new JerichoError(CODES.NOT_FOUND, `No existe ningún proceso gestionado con proc_id '${procId}'.`, {
        recoverable: true,
      });
    }
    if (sessionId && rec.session_id && rec.session_id !== sessionId) {
      throw new JerichoError(
        CODES.PROCESS_NOT_OWNED,
        `El proceso '${procId}' pertenece a otra sesión (${rec.session_id}).`,
        { details: { owner_session: rec.session_id } }
      );
    }
    return rec;
  }

  list({ sessionId = null } = {}) {
    return [...this.live.values()]
      .filter((r) => !sessionId || !r.session_id || r.session_id === sessionId)
      .map(({ child, ...rest }) => rest);
  }

  /**
   * Mata un proceso gestionado. Verifica identidad antes de enviar la señal:
   * si el PID ya no corresponde al proceso registrado (reutilización de PID),
   * NO se mata nada.
   */
  async kill(procId, { sessionId = null, reason = 'requested' } = {}) {
    const rec = this.get(procId, { sessionId });

    if (rec.status !== 'RUNNING') {
      return { proc_id: procId, killed: false, reason: `el proceso ya estaba en estado ${rec.status}` };
    }
    if (!ProcessRegistry.isAlive(rec.pid)) {
      this.markExit(procId, null);
      return { proc_id: procId, killed: false, reason: 'el proceso ya no existe' };
    }

    // Verificación anti-reutilización de PID.
    const nowStart = ProcessRegistry.processStartTime(rec.pid);
    if (rec.os_start_time && nowStart && nowStart !== rec.os_start_time) {
      throw new JerichoError(
        CODES.PROCESS_NOT_OWNED,
        `El PID ${rec.pid} ya no corresponde al proceso registrado (fue reutilizado por el sistema). No se envía ninguna señal.`,
        { details: { registered_start: rec.os_start_time, current_start: nowStart } }
      );
    }
    if (rec.os_start_time && !nowStart) {
      throw new JerichoError(
        CODES.PROCESS_NOT_OWNED,
        `No se puede verificar la identidad del PID ${rec.pid}. Jericho no mata procesos que no puede verificar.`,
        { recoverable: true }
      );
    }

    await ProcessRegistry._terminate(rec.pid, rec.child);
    this.markExit(procId, null);
    if (this.journal) {
      this.journal.append({ kind: 'process.killed', proc_id: procId, pid: rec.pid, reason });
    }
    return { proc_id: procId, killed: true, pid: rec.pid, reason };
  }

  static _terminate(pid, child) {
    return new Promise((resolve) => {
      if (isWindows) {
        execFile('taskkill', ['/PID', String(pid), '/F', '/T'], { timeout: 10_000 }, () => resolve());
      } else {
        try {
          process.kill(-pid, 'SIGKILL'); // grupo completo
        } catch (e) {
          try {
            if (child) child.kill('SIGKILL');
            else process.kill(pid, 'SIGKILL');
          } catch (e2) { /* ya muerto */ }
        }
        setTimeout(resolve, 50);
      }
    });
  }

  /** Procesos que superaron su TTL. Los mata el barrido periódico. */
  async sweepExpired() {
    const now = Date.now();
    const killed = [];
    for (const [procId, rec] of this.live.entries()) {
      if (rec.status !== 'RUNNING') continue;
      if (Date.parse(rec.expires_at) < now) {
        try {
          await this.kill(procId, { reason: 'ttl_expired' });
          killed.push(procId);
        } catch (e) {
          /* no verificable: se deja y se registra */
          if (this.journal) {
            this.journal.append({ kind: 'process.sweep_failed', proc_id: procId, error: e.code });
          }
        }
      }
    }
    return killed;
  }

  /**
   * Recuperación tras caída: lee el estado persistido de la ejecución anterior
   * y reporta procesos que quedaron huérfanos. Sólo se matan los que se pueden
   * verificar como los mismos que registramos.
   */
  async recoverOrphans({ kill = true } = {}) {
    const res = readJsonSafe(this.stateFile, { processes: [] });
    if (!res.ok) {
      return { recovered: 0, killed: 0, unverifiable: 0, error: res.error };
    }
    const prior = (res.value && res.value.processes) || [];
    let killedCount = 0;
    let unverifiable = 0;
    const orphans = [];
    for (const rec of prior) {
      if (rec.status !== 'RUNNING') continue;
      if (!ProcessRegistry.isAlive(rec.pid)) continue;
      const nowStart = ProcessRegistry.processStartTime(rec.pid);
      const sameProcess = rec.os_start_time && nowStart && nowStart === rec.os_start_time;
      if (!sameProcess) {
        unverifiable++;
        orphans.push({ ...rec, verified: false });
        continue;
      }
      orphans.push({ ...rec, verified: true });
      if (kill) {
        await ProcessRegistry._terminate(rec.pid, null);
        killedCount++;
        if (this.journal) {
          this.journal.append({ kind: 'process.orphan_killed', proc_id: rec.proc_id, pid: rec.pid, program: rec.program });
        }
      }
    }
    // Se reinicia el estado: la nueva ejecución empieza limpia.
    this.live.clear();
    this._persist();
    return { recovered: orphans.length, killed: killedCount, unverifiable, orphans };
  }

  async killAll(reason = 'shutdown') {
    for (const [procId, rec] of this.live.entries()) {
      if (rec.status !== 'RUNNING') continue;
      try {
        await this.kill(procId, { reason });
      } catch (e) {
        /* mejor esfuerzo en el apagado */
      }
    }
  }

  countRunning() {
    return [...this.live.values()].filter((r) => r.status === 'RUNNING').length;
  }
}

module.exports = { ProcessRegistry };
