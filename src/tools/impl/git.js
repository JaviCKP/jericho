'use strict';

const path = require('path');
const { GhostError, CODES } = require('../../core/errors');
const { Git } = require('../../core/git');

/**
 * Herramientas Git.
 *
 * Todas las invocaciones usan argv fijo (ver src/core/git.js). El mensaje de
 * commit y las rutas viajan como argumentos independientes: la inyección de
 * comandos que existía en v1 (`git commit -m "<mensaje>"`) ya no es posible.
 */

function repoPath(args, ctx) {
  return ctx.runtime.roots.resolve(args.path || '.', { root: args.root, mustExist: true });
}

/**
 * Convierte una ruta del modelo en un pathspec relativo AL REPOSITORIO.
 *
 * Dos comprobaciones, en este orden:
 *   1. la ruta debe estar dentro de una raíz autorizada (roots.resolve),
 *   2. y además dentro del repositorio sobre el que se opera.
 * Sin la segunda, un pathspec válido para la raíz pero externo al repo haría
 * fallar a git de forma confusa, o peor, tocaría otro repositorio.
 */
function repoRelative(file, repo, args, ctx) {
  const resolved = ctx.runtime.roots.resolve(file, { root: args.root });
  const rel = path.relative(repo.absolute, resolved.absolute).replace(/\\/g, '/');
  if (rel === '' || rel.startsWith('../')) {
    throw new GhostError(
      CODES.PATH_OUTSIDE_ROOT,
      `'${file}' está fuera del repositorio '${repo.relative || '.'}'.`,
      { recoverable: true, details: { repo: repo.relative || '.', resolved: resolved.relative } }
    );
  }
  return rel;
}

const inspect = {
  effects: () => ({ spawnsProcess: true, program: 'git' }),
  async run(args, ctx) {
    const git = new Git(ctx.runtime.runner);
    const repo = repoPath(args, ctx);
    const gctx = { session: ctx.session, traceId: ctx.trace_id, tool: 'git.inspect' };

    if (!(await git.isRepo(repo.absolute, gctx))) {
      throw new GhostError(CODES.NOT_FOUND, `'${repo.relative || '.'}' no es un repositorio Git.`, { recoverable: true });
    }

    if (args.action === 'status') {
      const [branch, head, status] = await Promise.all([
        git.branch(repo.absolute, gctx),
        git.headCommit(repo.absolute, gctx),
        git.statusPorcelain(repo.absolute, gctx),
      ]);
      return {
        action: 'status',
        repo_path: repo.relative || '.',
        branch,
        head_commit: head,
        clean: status.clean,
        entries: status.entries,
        __text:
          `rama: ${branch}\nHEAD: ${head}\n` +
          (status.clean ? 'árbol limpio' : `${status.entries.length} cambios:\n` + status.entries.map((e) => `  ${e.code.padEnd(3)} ${e.path}`).join('\n')),
      };
    }

    if (args.action === 'log') {
      const res = await git.log(repo.absolute, { max: args.max_commits || 15 }, gctx);
      return { action: 'log', repo_path: repo.relative || '.', commits: res.commits };
    }

    if (args.action === 'branches') {
      const branches = await git.listBranches(repo.absolute, gctx);
      const current = await git.branch(repo.absolute, gctx);
      return { action: 'branches', repo_path: repo.relative || '.', branches, branch: current };
    }

    // action === 'diff'
    let file = null;
    if (args.file) {
      file = repoRelative(args.file, repo, args, ctx);
    }
    const res = await git.diff(repo.absolute, { staged: !!args.staged, file }, gctx);
    return {
      action: 'diff',
      repo_path: repo.relative || '.',
      diff: res.diff,
      truncated: res.truncated,
    };
  },
};

const commit = {
  summary: (args) =>
    args.action === 'revert'
      ? `git revert ${args.commit}`
      : `git commit de ${(args.files || []).length} archivo(s): ${String(args.message || '').slice(0, 80)}`,
  effects: (args) => ({
    spawnsProcess: true,
    program: 'git',
    writesFiles: true,
    // Sin externalEffect: un commit local no sale de la máquina. `revert` tampoco
    // es destructivo (no reescribe historia: añade un commit que deshace).
    externalEffect: false,
  }),
  async run(args, ctx) {
    const git = new Git(ctx.runtime.runner);
    const repo = repoPath(args, ctx);
    const gctx = { session: ctx.session, traceId: ctx.trace_id, tool: 'git.commit' };

    if (!(await git.isRepo(repo.absolute, gctx))) {
      throw new GhostError(CODES.NOT_FOUND, `'${repo.relative || '.'}' no es un repositorio Git.`, { recoverable: true });
    }

    if (args.action === 'revert') {
      if (!args.commit) throw new GhostError(CODES.INVALID_ARGUMENT, 'commit es obligatorio para revert.');
      if (ctx.dryRun) {
        return { action: 'revert', dry_run: true, commit: args.commit, __text: `[SIMULACIÓN] git revert --no-edit ${args.commit}` };
      }
      const res = await git.revert(repo.absolute, { commit: args.commit }, gctx);
      if (!res.ok) throw new GhostError(CODES.INTERNAL, `git revert falló: ${res.error}`, { recoverable: true });
      return { action: 'revert', commit: res.new_head, previous_head: args.commit, __text: res.output };
    }

    // action === 'commit'
    if (!args.message) throw new GhostError(CODES.INVALID_ARGUMENT, 'message es obligatorio.');
    if (!args.files || !args.files.length) {
      throw new GhostError(
        CODES.INVALID_ARGUMENT,
        'files es obligatorio. GhostPC no hace `git add -A`: eso mezclaría cambios de otra sesión.',
        { recoverable: true, remediation: 'Usa git.inspect(status) y enumera los archivos que quieres incluir.' }
      );
    }

    // Cada archivo se valida contra la raíz autorizada Y contra el repositorio.
    const relFiles = args.files.map((f) => repoRelative(f, repo, args, ctx));
    const priorHead = await git.headCommit(repo.absolute, gctx);

    if (ctx.dryRun) {
      const status = await git.statusPorcelain(repo.absolute, gctx);
      return {
        action: 'commit',
        dry_run: true,
        staged_files: relFiles,
        previous_head: priorHead,
        __text:
          `[SIMULACIÓN] Se haría commit de:\n${relFiles.map((f) => '  ' + f).join('\n')}\n` +
          `mensaje: ${args.message}\n` +
          `HEAD actual: ${priorHead}\n` +
          `otros cambios sin incluir: ${status.entries.filter((e) => !relFiles.includes(e.path)).length}`,
      };
    }

    const res = await git.commit(repo.absolute, { message: args.message, files: relFiles, priorHead }, gctx);
    if (!res.ok) {
      throw new GhostError(CODES.INTERNAL, `git ${res.stage} falló: ${res.error}`, { recoverable: true });
    }

    ctx.runtime.journal.append({
      kind: 'git.commit',
      trace_id: ctx.trace_id,
      session_id: ctx.session.session_id,
      repo: repo.relative || '.',
      commit: res.commit,
      previous_head: priorHead,
      files: relFiles,
    });

    return {
      action: 'commit',
      commit: res.commit,
      previous_head: priorHead,
      staged_files: relFiles,
      rollback: res.rollback,
      __text: `commit ${res.commit}\n${res.output}\n\nrollback: git.commit(action="revert", commit="${res.commit}")`,
    };
  },
};

module.exports = {
  'git.inspect': inspect,
  'git.commit': commit,
};
