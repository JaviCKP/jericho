'use strict';

const fs = require('fs');
const path = require('path');
const { GhostError, CODES } = require('../../core/errors');

/**
 * terminal.exec y verify.run.
 *
 * No hay shell. `program` debe estar en la allowlist, `args` es una lista y los
 * metacaracteres se rechazan antes de llegar a spawn.
 */

function resolveCwd(args, ctx) {
  const { roots } = ctx.runtime;
  if (!args.cwd) {
    throw new GhostError(CODES.INVALID_ARGUMENT, 'cwd es obligatorio: GhostPC no ejecuta procesos sin directorio de trabajo explícito.', {
      recoverable: true,
      remediation: `Raíces disponibles: ${roots.list().map((r) => r.name).join(', ')}. Usa cwd="." con root="<nombre>".`,
    });
  }
  return roots.resolve(args.cwd, { root: args.root, mustExist: true });
}

const exec = {
  summary: (args) =>
    args.action === 'run' || args.action === 'start_background'
      ? `Ejecutar: ${args.program} ${(args.args || []).join(' ')}`.slice(0, 160)
      : `terminal.exec ${args.action}`,
  effects: (args, ctx) => {
    if (args.action === 'logs' || args.action === 'list') return {};
    // Detener sólo puede afectar a procesos que GhostPC creó y que pertenecen a
    // esta sesión (lo comprueba el registro). No es un efecto externo: es la
    // operación inversa de arrancarlo, que es R1. La protección real aquí es la
    // verificación de propiedad e identidad de PID, no una confirmación humana.
    if (args.action === 'stop') return { spawnsProcess: false, writesFiles: false };
    const secretNames = Array.isArray(args.secret_names) ? args.secret_names : [];
    // Se valida ANTES de la política: si un secreto no está autorizado, el error
    // correcto es SECRET_NOT_ALLOWED, no pedirle a una persona que apruebe algo
    // que de todos modos está prohibido.
    for (const name of secretNames) ctx.runtime.secrets.assertUsable(name);
    return {
      spawnsProcess: true,
      program: args.program,
      touchesSecrets: secretNames.length > 0,
      secretsPreauthorized: secretNames.length > 0,
    };
  },
  async run(args, ctx) {
    const { runner, registry } = ctx.runtime;

    if (args.action === 'list') {
      return {
        action: 'list',
        processes: registry.list({ sessionId: ctx.session.session_id }).map((p) => ({
          proc_id: p.proc_id,
          program: p.program,
          args: p.args,
          status: p.status,
          exit_code: p.exit_code,
          started_at: p.started_at,
          expires_at: p.expires_at,
          background: p.background,
        })),
      };
    }

    if (args.action === 'logs') {
      if (!args.proc_id) throw new GhostError(CODES.INVALID_ARGUMENT, 'proc_id es obligatorio para action="logs".');
      const res = runner.readLogs(args.proc_id, { maxLines: args.max_lines || 100, session: ctx.session });
      return { action: 'logs', ...res, untrusted_content: true };
    }

    if (args.action === 'stop') {
      if (!args.proc_id) throw new GhostError(CODES.INVALID_ARGUMENT, 'proc_id es obligatorio para action="stop".');
      const res = await registry.kill(args.proc_id, { sessionId: ctx.session.session_id, reason: 'requested_by_agent' });
      return { action: 'stop', proc_id: res.proc_id, ...res };
    }

    if (!args.program) {
      throw new GhostError(CODES.INVALID_ARGUMENT, 'program es obligatorio.', {
        recoverable: true,
        remediation: `Programas permitidos: ${ctx.runtime.policy.exec.allowed_programs.join(', ')}`,
      });
    }
    const cwd = resolveCwd(args, ctx);

    if (ctx.dryRun) {
      const plan = runner.plan({
        program: args.program,
        args: args.args || [],
        cwd: cwd.absolute,
        secretNames: args.secret_names || [],
      });
      return {
        action: args.action,
        program: plan.program,
        args: plan.args,
        plan: {
          executable: plan.executable,
          cwd: plan.cwd,
          via_cmd_shim: plan.via_cmd_shim,
          secrets_injected: plan.secrets_injected,
          environment: 'mínimo (env_passthrough de la política); NO hereda el entorno del servidor',
        },
        __text: `[SIMULACIÓN] Se ejecutaría: ${plan.executable} ${plan.args.join(' ')}\n  cwd: ${plan.cwd}`,
      };
    }

    if (args.action === 'start_background') {
      const res = runner.startBackground({
        program: args.program,
        args: args.args || [],
        cwd: cwd.absolute,
        ttlMs: args.ttl_ms,
        secretNames: args.secret_names || [],
        session: ctx.session,
        traceId: ctx.trace_id,
        tool: 'terminal.exec',
      });
      return {
        action: 'start_background',
        program: res.program,
        args: res.args,
        proc_id: res.proc_id,
        __text: `Proceso en segundo plano iniciado: ${res.proc_id} (${res.program}). Caduca a las ${res.expires_at}.`,
      };
    }

    // action === 'run'
    const res = await runner.run({
      program: args.program,
      args: args.args || [],
      cwd: cwd.absolute,
      timeoutMs: args.timeout_ms,
      secretNames: args.secret_names || [],
      session: ctx.session,
      traceId: ctx.trace_id,
      tool: 'terminal.exec',
    });

    return {
      action: 'run',
      program: res.program,
      args: res.args,
      exit_code: res.exit_code,
      stdout: res.stdout,
      stderr: res.stderr,
      duration_ms: res.duration_ms,
      truncated: res.truncated,
      timed_out: res.timed_out,
      untrusted_content: true,
      __text: formatRun(res, cwd.relative || '.'),
    };
  },
};

function formatRun(res, cwdRel) {
  const L = [];
  L.push(`$ ${res.program} ${res.args.join(' ')}    (cwd: ${cwdRel})`);
  L.push(`exit=${res.exit_code} · ${res.duration_ms}ms${res.timed_out ? ' · TIMEOUT' : ''}${res.truncated ? ' · SALIDA TRUNCADA' : ''}`);
  if (res.stdout.trim()) L.push('\n--- stdout (contenido no fiable) ---\n' + res.stdout.trim());
  if (res.stderr.trim()) L.push('\n--- stderr (contenido no fiable) ---\n' + res.stderr.trim());
  if (!res.stdout.trim() && !res.stderr.trim()) L.push('(sin salida)');
  return L.join('\n');
}

/* ------------------------------- verify.run ------------------------------ */

/** Comprobaciones estándar por tipo de proyecto. */
function detectCheckCommand(check, cwdAbs) {
  const pkgPath = path.join(cwdAbs, 'package.json');
  if (fs.existsSync(pkgPath)) {
    let pkg = {};
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch (e) { /* package.json ilegible: se cae al genérico */ }
    const scripts = pkg.scripts || {};
    const map = { test: 'test', lint: 'lint', build: 'build', typecheck: 'typecheck' };
    const scriptName = map[check];
    if (scriptName && scripts[scriptName]) {
      return { program: 'npm', args: ['run', '--silent', scriptName] };
    }
    if (check === 'test' && scripts.test) return { program: 'npm', args: ['test', '--silent'] };
    if (check === 'typecheck' && fs.existsSync(path.join(cwdAbs, 'tsconfig.json'))) {
      return { program: 'npx', args: ['tsc', '--noEmit'] };
    }
  }
  if (check === 'test' && fs.existsSync(path.join(cwdAbs, 'pytest.ini'))) {
    return { program: 'pytest', args: ['-q'] };
  }
  if (check === 'test' && fs.existsSync(path.join(cwdAbs, 'Cargo.toml'))) {
    return { program: 'cargo', args: ['test'] };
  }
  if (check === 'build' && fs.existsSync(path.join(cwdAbs, 'Cargo.toml'))) {
    return { program: 'cargo', args: ['build'] };
  }
  return null;
}

const verify = {
  summary: (args) => `verify.run ${args.check}`,
  effects: (args) => ({ spawnsProcess: true, program: args.program || 'verificación' }),
  async run(args, ctx) {
    const { runner } = ctx.runtime;
    const cwd = resolveCwd(args, ctx);

    let cmd;
    if (args.check === 'custom') {
      if (!args.program) throw new GhostError(CODES.INVALID_ARGUMENT, 'program es obligatorio cuando check="custom".');
      cmd = { program: args.program, args: args.args || [] };
    } else {
      cmd = detectCheckCommand(args.check, cwd.absolute);
      if (!cmd) {
        throw new GhostError(
          CODES.NOT_FOUND,
          `No se pudo determinar cómo ejecutar '${args.check}' en ${cwd.relative || '.'}.`,
          {
            recoverable: true,
            remediation: 'Usa check="custom" indicando program y args explícitos.',
          }
        );
      }
    }

    const res = await runner.run({
      program: cmd.program,
      args: cmd.args,
      cwd: cwd.absolute,
      timeoutMs: args.timeout_ms || 300_000,
      session: ctx.session,
      traceId: ctx.trace_id,
      tool: 'verify.run',
    });

    const passed = res.exit_code === 0 && !res.timed_out;
    const tail = (res.stdout + '\n' + res.stderr).trim().split('\n').slice(-40).join('\n');

    ctx.runtime.journal.append({
      kind: 'verify.result',
      trace_id: ctx.trace_id,
      check: args.check,
      command: `${cmd.program} ${cmd.args.join(' ')}`,
      cwd: cwd.relative || '.',
      passed,
      exit_code: res.exit_code,
      duration_ms: res.duration_ms,
    });

    return {
      check: args.check,
      passed,
      exit_code: res.exit_code,
      command: `${cmd.program} ${cmd.args.join(' ')}`,
      duration_ms: res.duration_ms,
      output_tail: tail,
      // Esto es lo que se pega en memory.checkpoint para cerrar un criterio.
      evidence: {
        kind: args.check === 'test' ? 'test' : 'command',
        result: passed ? 'pass' : 'fail',
        trace_id: ctx.trace_id,
        at: new Date().toISOString(),
        detail: `${cmd.program} ${cmd.args.join(' ')} -> exit ${res.exit_code}`,
      },
      __text:
        `verify.run(${args.check}) -> ${passed ? 'PASA' : 'FALLA'} (exit=${res.exit_code}, ${res.duration_ms}ms)\n` +
        `comando: ${cmd.program} ${cmd.args.join(' ')}\n\n${tail}\n\n` +
        `evidencia utilizable: trace_id=${ctx.trace_id}`,
    };
  },
};

module.exports = {
  'terminal.exec': exec,
  'verify.run': verify,
};
