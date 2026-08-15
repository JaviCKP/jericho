'use strict';

const { GhostError, CODES } = require('./errors');

/**
 * Fachada Git segura.
 *
 * Todas las invocaciones se construyen con argv FIJO desde el código. Nada de
 * lo que envía el modelo se concatena en una cadena de shell (ese fue el
 * vector P0-4 del prototipo: `git commit -m "<mensaje>"` era inyectable).
 *
 * El mensaje de commit se pasa como argumento independiente, así que ni las
 * comillas ni `&` ni `|` tienen ningún efecto.
 */

class Git {
  constructor(runner) {
    this.runner = runner;
  }

  async _git(args, cwd, { session, traceId, tool, timeoutMs = 20_000 } = {}) {
    return this.runner.run({
      program: 'git',
      args,
      cwd,
      timeoutMs,
      session,
      traceId,
      tool: tool || 'git',
    });
  }

  async isRepo(cwd, ctx = {}) {
    try {
      const r = await this._git(['rev-parse', '--is-inside-work-tree'], cwd, ctx);
      return r.exit_code === 0 && r.stdout.trim() === 'true';
    } catch (e) {
      return false;
    }
  }

  async branch(cwd, ctx = {}) {
    const r = await this._git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, ctx);
    return r.exit_code === 0 ? r.stdout.trim() : null;
  }

  async headCommit(cwd, ctx = {}) {
    const r = await this._git(['rev-parse', 'HEAD'], cwd, ctx);
    return r.exit_code === 0 ? r.stdout.trim() : null;
  }

  async statusPorcelain(cwd, ctx = {}) {
    const r = await this._git(['status', '--porcelain=v1', '--untracked-files=normal'], cwd, ctx);
    if (r.exit_code !== 0) return { ok: false, error: r.stderr.trim(), entries: [] };
    const entries = r.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => ({ code: line.slice(0, 2).trim(), path: line.slice(3) }));
    return { ok: true, entries, clean: entries.length === 0 };
  }

  async log(cwd, { max = 15 } = {}, ctx = {}) {
    const n = Math.max(1, Math.min(Number(max) || 15, 200));
    const r = await this._git(
      ['log', `-n`, String(n), '--pretty=format:%H%x1f%an%x1f%aI%x1f%s', '--no-color'],
      cwd,
      ctx
    );
    if (r.exit_code !== 0) return { ok: false, error: r.stderr.trim(), commits: [] };
    const commits = r.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, author, date, subject] = line.split('\x1f');
        return { hash, author, date, subject };
      });
    return { ok: true, commits };
  }

  async diff(cwd, { staged = false, file = null, maxLines = 2000 } = {}, ctx = {}) {
    const args = ['diff', '--no-color'];
    if (staged) args.push('--staged');
    if (file) {
      // El separador '--' impide que una ruta que empiece por '-' se lea como opción.
      args.push('--', file);
    }
    const r = await this._git(args, cwd, ctx);
    const lines = r.stdout.split('\n');
    return {
      ok: r.exit_code === 0,
      truncated: lines.length > maxLines,
      diff: lines.slice(0, maxLines).join('\n'),
      error: r.exit_code === 0 ? null : r.stderr.trim(),
    };
  }

  /** Commit con mensaje pasado como argv separado: no hay inyección posible. */
  async commit(cwd, { message, files = [], allowEmpty = false, priorHead = null }, ctx = {}) {
    if (typeof message !== 'string' || message.trim().length === 0) {
      throw new GhostError(CODES.INVALID_ARGUMENT, 'El mensaje de commit es obligatorio.');
    }
    if (message.length > 4000) {
      throw new GhostError(CODES.LIMIT_EXCEEDED, 'Mensaje de commit demasiado largo (máx. 4000).');
    }
    if (!Array.isArray(files) || files.length === 0) {
      throw new GhostError(
        CODES.INVALID_ARGUMENT,
        'Debes indicar explícitamente los archivos a incluir. GhostPC no hace `git add -A`: ' +
          'eso mezclaría cambios de otra sesión que estuviera trabajando en el mismo árbol.'
      );
    }
    const addArgs = ['add', '--', ...files];
    const addRes = await this._git(addArgs, cwd, ctx);
    if (addRes.exit_code !== 0) {
      return { ok: false, stage: 'add', error: addRes.stderr.trim() || addRes.stdout.trim() };
    }
    const commitArgs = ['commit', '-m', message];
    if (allowEmpty) commitArgs.push('--allow-empty');
    const res = await this._git(commitArgs, cwd, ctx);
    if (res.exit_code !== 0) {
      return { ok: false, stage: 'commit', error: res.stderr.trim() || res.stdout.trim() };
    }
    const head = await this.headCommit(cwd, ctx);
    return {
      ok: true,
      commit: head,
      output: res.stdout.trim(),
      previous_head: priorHead,
      // Ruta de rollback explícita. `revert` no reescribe historia, así que no
      // está en la lista de subcomandos prohibidos y es seguro para el agente.
      rollback: {
        tool: 'git.revert',
        commit: head,
        manual_command: `git -C "${cwd}" revert --no-edit ${head}`,
      },
    };
  }

  /**
   * Rollback de un commit mediante `git revert` (no reescribe historia).
   * `git reset` queda fuera de la allowlist a propósito.
   */
  async revert(cwd, { commit }, ctx = {}) {
    if (typeof commit !== 'string' || !/^[0-9a-f]{7,40}$/i.test(commit)) {
      throw new GhostError(CODES.INVALID_ARGUMENT, 'El commit a revertir debe ser un hash hexadecimal.');
    }
    const r = await this._git(['revert', '--no-edit', commit], cwd, ctx);
    return {
      ok: r.exit_code === 0,
      output: r.stdout.trim(),
      error: r.exit_code === 0 ? null : r.stderr.trim(),
      new_head: r.exit_code === 0 ? await this.headCommit(cwd, ctx) : null,
    };
  }

  async listBranches(cwd, ctx = {}) {
    const r = await this._git(['branch', '--list', '--format=%(refname:short)'], cwd, ctx);
    return r.exit_code === 0 ? r.stdout.split('\n').filter(Boolean) : [];
  }
}

module.exports = { Git };
