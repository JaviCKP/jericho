'use strict';

const { spawn } = require('child_process');
const { JerichoError, CODES } = require('../errors');
const { resolveProgram, validateArgs, assertSubcommandAllowed, buildChildEnv } = require('./program');
const redact = require('../redact');
const { isElevated } = require('../../utils/platform');

const isWindows = process.platform === 'win32';

/** Entrecomilla un argumento para cmd.exe. Ya se rechazaron los metacaracteres. */
function quoteForCmd(arg) {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

/**
 * Ejecutor de procesos aislado.
 *
 * Garantías:
 *  - cwd obligatorio y resuelto dentro de una raíz autorizada (lo hace el llamante).
 *  - programa de la allowlist + argv; nunca una cadena de shell.
 *  - entorno mínimo; NO se hereda process.env (los secretos no viajan al hijo
 *    salvo inyección explícita por el SecretBroker).
 *  - timeout de pared, límite de bytes de salida y límite de concurrencia.
 *  - salida redactada antes de devolverse.
 *
 * LÍMITE CONOCIDO: no se imponen cuotas duras de CPU ni de memoria. Eso exige
 * Job Objects (Windows) o cgroups (Linux) y queda documentado como riesgo
 * residual en SECURITY.md. Sí se aplican timeout, TTL y matado del árbol.
 */

class ExecRunner {
  constructor({ policy, registry, secrets, journal, metrics }) {
    this.policy = policy;
    this.registry = registry;
    this.secrets = secrets;
    this.journal = journal;
    this.metrics = metrics;
    this.running = 0;
  }

  _limits() {
    return this.policy.limits.exec;
  }

  _assertConcurrency(background) {
    const lim = this._limits();
    if (this.running >= lim.max_concurrent) {
      throw new JerichoError(
        CODES.LIMIT_EXCEEDED,
        `Ya hay ${this.running} procesos en ejecución (máx. ${lim.max_concurrent}).`,
        { recoverable: true, remediation: 'Espera a que terminen o detén alguno con terminal.processes.' }
      );
    }
    if (background && this.registry.countRunning() >= lim.max_background) {
      throw new JerichoError(
        CODES.LIMIT_EXCEEDED,
        `Ya hay ${this.registry.countRunning()} procesos en segundo plano (máx. ${lim.max_background}).`,
        { recoverable: true }
      );
    }
  }

  /**
   * Prepara la invocación. Se expone aparte para que el dry-run muestre
   * EXACTAMENTE lo que se ejecutaría sin ejecutarlo.
   */
  plan({ program, args = [], cwd, secretNames = [] }) {
    if (isElevated()) {
      throw new JerichoError(
        CODES.COMMAND_NOT_ALLOWED,
        'El servidor estÃ¡ elevado; se rechazan procesos hijos generales al no existir aislamiento de privilegios demostrable.',
        { details: { reason: 'elevated_server_no_child_isolation' } }
      );
    }
    const resolved = resolveProgram(program, this.policy.exec);
    // La validación estricta de metacaracteres SÓLO aplica a lanzadores .cmd/.bat
    // de Windows, que obligan a pasar por cmd.exe. Ver src/core/exec/program.js.
    const viaCmd = !!(resolved.isBatch && isWindows);
    const safeArgs = validateArgs(args, { strict: viaCmd });
    assertSubcommandAllowed(resolved.name, safeArgs, this.policy.exec);
    if (!cwd) {
      throw new JerichoError(CODES.INVALID_ARGUMENT, 'cwd es obligatorio: Jericho no ejecuta procesos sin directorio de trabajo.');
    }
    for (const name of secretNames) {
      if (!this.secrets.isAvailable(name)) {
        // Provoca el error tipado correcto (SECRET_NOT_ALLOWED / NOT_AVAILABLE).
        this.secrets.materializeForProcess([name], { program: resolved.name });
      }
    }
    // Los lanzadores .cmd/.bat de Windows obligan a pasar por cmd.exe. Sus
    // argumentos ya pasaron la validación estricta, así que cmd no puede
    // reinterpretarlos como comandos.
    const finalArgs = [...(resolved.prependArgs || []), ...safeArgs];
    const spawnPlan = viaCmd
      ? {
          // cmd.exe con /s consume el primer y el último entrecomillado, así que
          // toda la línea se envuelve en un par extra. Con verbatim, Node no
          // vuelve a entrecomillar y la línea llega tal cual.
          file: process.env.COMSPEC || 'cmd.exe',
          argv: ['/d', '/s', '/c', `""${resolved.executable}" ${finalArgs.map(quoteForCmd).join(' ')}"`],
          verbatim: true,
        }
      : { file: resolved.executable, argv: finalArgs };

    return {
      program: resolved.name,
      executable: resolved.executable,
      args: safeArgs,
      cwd,
      via_cmd_shim: viaCmd,
      secrets_injected: secretNames,
      spawnPlan,
    };
  }

  /**
   * Ejecuta en primer plano y espera el resultado.
   * @returns {Promise<{exit_code, stdout, stderr, duration_ms, truncated, timed_out}>}
   */
  async run({ program, args, cwd, timeoutMs, secretNames = [], session = {}, traceId = null, tool = null }) {
    const lim = this._limits();
    const plan = this.plan({ program, args, cwd, secretNames });
    this._assertConcurrency(false);

    const timeout = Math.min(timeoutMs || lim.timeout_ms, lim.timeout_ms);
    const maxBytes = lim.max_output_bytes;

    const secretEnv = secretNames.length
      ? this.secrets.materializeForProcess(secretNames, { tool, trace_id: traceId, program: plan.program })
      : {};
    const env = buildChildEnv(this.policy.exec, secretEnv);

    this.running++;
    const started = Date.now();
    let procId = null;

    try {
      return await new Promise((resolve, reject) => {
        let child;
        try {
          child = spawn(plan.spawnPlan.file, plan.spawnPlan.argv, {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            windowsVerbatimArguments: !!plan.spawnPlan.verbatim,
            detached: !isWindows, // grupo propio en POSIX para poder matar el árbol
          });
        } catch (err) {
          return reject(new JerichoError(CODES.INTERNAL, `No se pudo lanzar '${plan.program}': ${err.message}`));
        }

        procId = this.registry.register({
          child,
          program: plan.program,
          args: plan.args,
          cwd,
          sessionId: session.session_id,
          projectId: session.project_id,
          traceId,
          ttlMs: timeout + 5_000,
          background: false,
        });

        let stdout = '';
        let stderr = '';
        let bytes = 0;
        let truncated = false;
        let timedOut = false;
        let settled = false;

        const capture = (chunk, isErr) => {
          const text = chunk.toString();
          bytes += Buffer.byteLength(text);
          if (bytes > maxBytes) {
            if (!truncated) {
              truncated = true;
              // Se corta el grifo: no se acumulan 20 MB para luego tirarlos.
              try { child.stdout.destroy(); child.stderr.destroy(); } catch (e) { /* ignorado */ }
            }
            return;
          }
          if (isErr) stderr += text;
          else stdout += text;
        };

        child.stdout.on('data', (c) => capture(c, false));
        child.stderr.on('data', (c) => capture(c, true));

        const timer = setTimeout(async () => {
          timedOut = true;
          try {
            await this.registry.kill(procId, { reason: 'timeout' });
          } catch (e) { /* mejor esfuerzo */ }
        }, timeout);

        const finish = (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.registry.markExit(procId, code);
          const duration = Date.now() - started;
          resolve({
            program: plan.program,
            args: plan.args,
            cwd,
            exit_code: code,
            stdout: redact.redactText(stdout),
            stderr: redact.redactText(stderr),
            duration_ms: duration,
            truncated,
            timed_out: timedOut,
            output_bytes: bytes,
            secrets_injected: secretNames,
          });
        };

        child.on('error', (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.registry.markExit(procId, -1);
          reject(new JerichoError(CODES.INTERNAL, `Fallo ejecutando '${plan.program}': ${err.message}`, { recoverable: true }));
        });
        child.on('close', (code) => finish(code));
      });
    } finally {
      this.running--;
    }
  }

  /** Lanza en segundo plano y devuelve el identificador de proceso. */
  startBackground({ program, args, cwd, ttlMs, secretNames = [], session = {}, traceId = null, tool = null }) {
    const lim = this._limits();
    const plan = this.plan({ program, args, cwd, secretNames });
    this._assertConcurrency(true);

    const secretEnv = secretNames.length
      ? this.secrets.materializeForProcess(secretNames, { tool, trace_id: traceId, program: plan.program })
      : {};
    const env = buildChildEnv(this.policy.exec, secretEnv);
    const ttl = Math.min(ttlMs || lim.background_ttl_ms, lim.background_ttl_ms);

    const child = spawn(plan.spawnPlan.file, plan.spawnPlan.argv, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: !!plan.spawnPlan.verbatim,
      detached: !isWindows,
    });

    const procId = this.registry.register({
      child,
      program: plan.program,
      args: plan.args,
      cwd,
      sessionId: session.session_id,
      projectId: session.project_id,
      traceId,
      ttlMs: ttl,
      background: true,
    });

    const rec = this.registry.live.get(procId);
    rec.logs = [];
    rec.log_bytes = 0;
    const maxLogBytes = lim.max_output_bytes;

    const push = (chunk, isErr) => {
      const text = chunk.toString();
      rec.log_bytes += Buffer.byteLength(text);
      if (rec.log_bytes > maxLogBytes) {
        rec.log_truncated = true;
        return;
      }
      rec.logs.push({ t: new Date().toISOString(), stream: isErr ? 'stderr' : 'stdout', text: redact.redactText(text) });
      if (rec.logs.length > 1000) rec.logs.shift();
    };
    child.stdout.on('data', (c) => push(c, false));
    child.stderr.on('data', (c) => push(c, true));
    child.on('close', (code) => this.registry.markExit(procId, code));
    child.on('error', () => this.registry.markExit(procId, -1));

    return {
      proc_id: procId,
      pid: child.pid,
      program: plan.program,
      args: plan.args,
      cwd,
      expires_at: new Date(Date.now() + ttl).toISOString(),
    };
  }

  readLogs(procId, { maxLines = 100, session = {} } = {}) {
    const rec = this.registry.get(procId, { sessionId: session.session_id });
    const logs = (rec.logs || []).slice(-Math.min(maxLines, 500));
    return {
      proc_id: procId,
      pid: rec.pid,
      status: rec.status,
      exit_code: rec.exit_code,
      program: rec.program,
      truncated: !!rec.log_truncated,
      lines: logs,
    };
  }
}

module.exports = { ExecRunner };
