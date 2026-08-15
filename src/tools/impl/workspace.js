'use strict';

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const crypto = require('crypto');
const { GhostError, CODES } = require('../../core/errors');
const { sha256Text } = require('../../core/atomic');
const { applyPatch, rollbackPatch } = require('../../core/patch/apply');

/**
 * Herramientas de workspace.
 *
 * Todas las rutas pasan por `runtime.roots.resolve`, que es el único punto que
 * convierte una cadena del modelo en una ruta de disco. No se usa `fs` con
 * rutas sin resolver en ningún sitio de este archivo.
 */

const IGNORE = ['**/node_modules/**', '**/.git/**', '**/.next/**', '**/dist/**', '**/build/**', '**/.venv/**', '**/__pycache__/**'];
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.exe', '.dll', '.so', '.dylib', '.woff', '.woff2', '.ttf', '.mp4', '.mp3']);

const MAX_FILE_BYTES = 2_000_000;

/* --------------------------- workspace.inspect --------------------------- */

const inspect = {
  effects: () => ({}),
  async run(args, ctx) {
    const { roots } = ctx.runtime;

    if (args.action === 'roots') {
      return {
        action: 'roots',
        roots: roots.list().map((r) => ({
          name: r.name,
          path: r.path,
          writable: r.write,
        })),
      };
    }

    const resolved = roots.resolve(args.path || '.', { root: args.root, mustExist: true });

    if (args.action === 'stat') {
      const st = fs.statSync(resolved.absolute);
      const isFile = st.isFile();
      return {
        action: 'stat',
        stat: {
          path: resolved.relative,
          root: resolved.root.name,
          type: isFile ? 'file' : st.isDirectory() ? 'directory' : 'other',
          size_bytes: st.size,
          modified_at: st.mtime.toISOString(),
          sha256: isFile && st.size <= MAX_FILE_BYTES ? sha256Text(fs.readFileSync(resolved.absolute, 'utf-8')) : null,
        },
      };
    }

    // action === 'tree'
    const maxDepth = args.max_depth || 3;
    const maxEntries = args.max_entries || 500;
    const entries = [];
    let truncated = false;

    const walk = (dir, depth, relPrefix) => {
      if (depth > maxDepth || entries.length >= maxEntries) return;
      let items;
      try {
        items = fs.readdirSync(dir, { withFileTypes: true });
      } catch (err) {
        entries.push({ path: relPrefix, type: 'error', note: `no legible: ${err.code}` });
        return;
      }
      for (const it of items.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entries.length >= maxEntries) {
          truncated = true;
          return;
        }
        if (['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.venv'].includes(it.name)) continue;
        const rel = relPrefix ? `${relPrefix}/${it.name}` : it.name;
        const abs = path.join(dir, it.name);
        // Un enlace que salga de la raíz no se lista.
        if (!roots.tryResolve(abs)) continue;
        if (it.isDirectory()) {
          entries.push({ path: rel + '/', type: 'directory', depth });
          walk(abs, depth + 1, rel);
        } else {
          let size = null;
          try {
            size = fs.statSync(abs).size;
          } catch (e) { /* ignorado: se muestra sin tamaño */ }
          entries.push({ path: rel, type: 'file', depth, size_bytes: size });
        }
      }
    };
    walk(resolved.absolute, 1, '');

    return {
      action: 'tree',
      root: resolved.root.name,
      base: resolved.relative || '.',
      tree: entries,
      truncated,
    };
  },
};

/* --------------------------- workspace.search ---------------------------- */

const search = {
  effects: () => ({}),
  async run(args, ctx) {
    const { roots, policy } = ctx.runtime;
    const base = roots.resolve(args.path || '.', { root: args.root, mustExist: true });
    const maxResults = args.max_results || 100;

    if (args.mode === 'files') {
      const matches = await glob(args.pattern, {
        cwd: base.absolute,
        nodir: false,
        ignore: IGNORE,
        maxDepth: 12,
        dot: false,
        follow: false,
      });
      const allowed = [];
      for (const m of matches) {
        if (allowed.length >= maxResults) break;
        const r = roots.tryResolve(path.join(base.absolute, m));
        if (r) allowed.push({ path: r.relative, root: r.root.name });
      }
      return {
        mode: 'files',
        total_found: matches.length,
        returned: allowed.length,
        truncated: matches.length > allowed.length,
        results: allowed,
        untrusted_content: true,
      };
    }

    // mode === 'content'
    const fileGlob = args.file_glob || '**/*';
    const files = await glob(fileGlob, {
      cwd: base.absolute,
      nodir: true,
      ignore: IGNORE,
      maxDepth: 12,
      follow: false,
    });

    let regex = null;
    if (args.is_regex) {
      try {
        regex = new RegExp(args.pattern, 'i');
      } catch (e) {
        throw new GhostError(CODES.INVALID_ARGUMENT, `Expresión regular inválida: ${e.message}`, { recoverable: true });
      }
    }
    const needle = args.pattern.toLowerCase();

    const results = [];
    let scanned = 0;
    let skipped = 0;
    for (const f of files) {
      if (results.length >= maxResults) break;
      const r = roots.tryResolve(path.join(base.absolute, f));
      if (!r) {
        skipped++;
        continue;
      }
      if (BINARY_EXT.has(path.extname(f).toLowerCase())) continue;
      let content;
      try {
        const st = fs.statSync(r.absolute);
        if (st.size > MAX_FILE_BYTES) continue;
        content = fs.readFileSync(r.absolute, 'utf-8');
      } catch (err) {
        // No se silencia: se informa de por qué no se pudo leer.
        results.push({ file: r.relative, line: 0, text: `[no legible: ${err.code}]`, unreadable: true });
        continue;
      }
      scanned++;
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        const hit = regex ? regex.test(lines[i]) : lines[i].toLowerCase().includes(needle);
        if (hit) {
          results.push({ file: r.relative, line: i + 1, text: lines[i].trim().slice(0, 400) });
        }
      }
    }

    return {
      mode: 'content',
      total_found: results.length,
      returned: results.length,
      truncated: results.length >= maxResults,
      files_scanned: scanned,
      files_skipped_by_policy: skipped,
      results,
      untrusted_content: true,
    };
  },
};

/* ---------------------------- workspace.read ----------------------------- */

const read = {
  effects: () => ({}),
  async run(args, ctx) {
    const { roots, policy } = ctx.runtime;
    const files = [];
    let budget = policy.limits.output.max_chars;

    for (const p of args.paths) {
      let resolved;
      try {
        resolved = roots.resolve(p, { root: args.root, mustExist: true });
      } catch (err) {
        files.push({ path: p, error: err.code, message: err.message });
        continue;
      }
      const st = fs.statSync(resolved.absolute);
      if (st.isDirectory()) {
        files.push({ path: resolved.relative, error: CODES.INVALID_ARGUMENT, message: 'es un directorio; usa workspace.inspect' });
        continue;
      }
      if (st.size > MAX_FILE_BYTES) {
        files.push({ path: resolved.relative, error: CODES.LIMIT_EXCEEDED, message: `archivo de ${st.size} bytes; máximo ${MAX_FILE_BYTES}` });
        continue;
      }
      const content = fs.readFileSync(resolved.absolute, 'utf-8');
      const allLines = content.split(/\r?\n/);
      const start = Math.max(1, args.start_line || 1);
      const end = Math.min(allLines.length, args.end_line || allLines.length);
      const slice = allLines.slice(start - 1, end);
      let text = args.with_line_numbers
        ? slice.map((l, i) => `${start + i}: ${l}`).join('\n')
        : slice.join('\n');
      let truncated = false;
      if (text.length > budget) {
        text = text.slice(0, Math.max(0, budget));
        truncated = true;
      }
      budget -= text.length;

      files.push({
        path: resolved.relative,
        root: resolved.root.name,
        // sha256 del archivo COMPLETO: es el que hay que pasar a apply_patch.
        sha256: sha256Text(content),
        total_lines: allLines.length,
        shown_lines: [start, end],
        size_bytes: st.size,
        modified_at: st.mtime.toISOString(),
        truncated,
        content: text,
      });
    }

    return { files, untrusted_content: true };
  },
};

/* ------------------------- workspace.apply_patch ------------------------- */

const applyPatchTool = {
  summary: (args) => `Aplicar parche de ${Buffer.byteLength(args.patch || '')} bytes`,
  effects: (args, ctx) => ({
    writesFiles: !args.dry_run,
    root: args.root || undefined,
    // Un parche que sólo borra archivos es destructivo -> R3.
    destructive: !args.dry_run && /^\+\+\+ \/dev\/null$/m.test(args.patch || ''),
  }),
  async run(args, ctx) {
    const { roots, policy, journal } = ctx.runtime;

    const result = applyPatch({
      patch: args.patch,
      roots,
      root: args.root,
      expected_hashes: args.expected_hashes || {},
      dryRun: ctx.dryRun,
      maxFiles: policy.limits.patch.max_files,
      maxBytes: policy.limits.patch.max_bytes,
    });

    let rollbackToken = null;
    if (result.applied) {
      rollbackToken = 'rb_' + crypto.randomBytes(8).toString('hex');
      ctx.dispatcher.rollbacks.set(rollbackToken, {
        state: result.rollback_state,
        created_at: Date.now(),
        session_id: ctx.session.session_id,
      });
      // Se limpian tokens de más de una hora.
      for (const [k, v] of ctx.dispatcher.rollbacks) {
        if (Date.now() - v.created_at > 3600_000) ctx.dispatcher.rollbacks.delete(k);
      }
      journal.append({
        kind: 'patch.applied',
        trace_id: ctx.trace_id,
        session_id: ctx.session.session_id,
        files: result.files.map((f) => ({ path: f.path, op: f.operation, before: f.before_sha256, after: f.after_sha256 })),
        rollback_token: rollbackToken,
      });
    }

    let formatter = null;
    if (result.applied && args.run_formatter) {
      formatter = await runFormatter(ctx, result.files.map((f) => f.path), args.root);
    }

    return {
      applied: result.applied,
      dry_run: result.dry_run,
      files: result.files,
      rollback_token: rollbackToken,
      formatter,
      __text:
        (result.dry_run ? '[SIMULACIÓN] ' : '') +
        result.message +
        (rollbackToken ? `\nrollback_token: ${rollbackToken}` : '') +
        '\n' +
        result.files.map((f) => `  ${f.operation.padEnd(6)} ${f.path}  (+${f.lines_added}/-${f.lines_removed})`).join('\n'),
    };
  },
};

async function runFormatter(ctx, files, root) {
  const { roots, runner } = ctx.runtime;
  const rootDef = root ? roots.byName(root) : roots.list()[0];
  if (!rootDef) return { ran: false, reason: 'sin raíz' };
  const hasPrettier = fs.existsSync(path.join(rootDef.path, 'node_modules', '.bin', 'prettier'));
  if (!hasPrettier) return { ran: false, reason: 'no se encontró prettier en el proyecto' };
  try {
    const res = await runner.run({
      program: 'npx',
      args: ['prettier', '--write', ...files],
      cwd: rootDef.path,
      timeoutMs: 60_000,
      session: ctx.session,
      traceId: ctx.trace_id,
      tool: 'workspace.apply_patch',
    });
    return { ran: true, exit_code: res.exit_code, output: res.stdout.slice(0, 2000) };
  } catch (err) {
    return { ran: false, reason: err.message };
  }
}

/* -------------------------- workspace.rollback --------------------------- */

const rollback = {
  summary: () => 'Deshacer un parche aplicado',
  effects: () => ({ writesFiles: true }),
  async run(args, ctx) {
    const entry = ctx.dispatcher.rollbacks.get(args.rollback_token);
    if (!entry) {
      throw new GhostError(
        CODES.NOT_FOUND,
        `rollback_token '${args.rollback_token}' desconocido o caducado (los tokens duran 1 hora y no sobreviven a un reinicio).`,
        { recoverable: false, remediation: 'Usa git.inspect(diff) y genera un parche inverso.' }
      );
    }
    const res = rollbackPatch(entry.state);
    ctx.dispatcher.rollbacks.delete(args.rollback_token);
    ctx.runtime.metrics.bump('rollbacks');
    ctx.runtime.journal.append({
      kind: 'patch.rolled_back',
      trace_id: ctx.trace_id,
      rollback_token: args.rollback_token,
      restored: res.restored.length,
      failed: res.failed.length,
    });
    return { restored: res.restored, failed: res.failed };
  },
};

module.exports = {
  'workspace.inspect': inspect,
  'workspace.search': search,
  'workspace.read': read,
  'workspace.apply_patch': applyPatchTool,
  'workspace.rollback': rollback,
};
