'use strict';

const { BY_NAME, toMcpTool } = require('./catalog');
const { LEGACY_ALIASES } = require('./profiles');
const { assertValidInput, checkOutput } = require('./validate');
const { GhostError, CODES } = require('../core/errors');
const { newTraceId, validateExternalId, ANONYMOUS_SESSION } = require('../core/ids');
const redact = require('../core/redact');

/**
 * Punto único de entrada de toda llamada a herramienta.
 *
 * Secuencia fija, sin atajos:
 *   1. resolver la herramienta (o explicar el alias v1 equivalente)
 *   2. validar la entrada contra el inputSchema ESTRICTO
 *   3. derivar identidad explícita (nunca la conexión MCP)
 *   4. calcular los efectos declarados por la herramienta
 *   5. PolicyEngine.authorize  <- aquí se deniega o se pide aprobación
 *   6. ejecutar
 *   7. validar la salida contra el outputSchema
 *   8. cortafuegos de secretos
 *   9. diario + métricas
 */

class Dispatcher {
  constructor(runtime, implementations, { legacyMode = 'explain' } = {}) {
    this.runtime = runtime;
    this.impls = implementations;
    this.legacyMode = legacyMode; // 'explain' | 'translate' | 'off'
    this.rollbacks = new Map(); // rollback_token -> estado previo
  }

  /** Herramientas visibles para este cliente: sólo las de los perfiles activos. */
  listTools() {
    return this.runtime.engine
      .enabledToolNames()
      .map((n) => BY_NAME.get(n))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(toMcpTool);
  }

  _resolveLegacy(name) {
    const alias = LEGACY_ALIASES[name];
    if (!alias) return null;
    const target = alias.tool ? BY_NAME.get(alias.tool) : null;
    const enabled = target && this.runtime.engine.isToolEnabled(target.name);
    return { alias, target, enabled };
  }

  async call(name, rawArgs, trustedContext = null) {
    const traceId = newTraceId();
    const started = Date.now();
    const def = BY_NAME.get(name);

    if (!def) {
      const legacy = this._resolveLegacy(name);
      if (legacy) {
        // Traducción inteligente automática para herramientas legacy de GPTs personalizados
        if (name === 'write_file' || name === 'create_file') {
          const filePath = (rawArgs && (rawArgs.path || rawArgs.file_path || rawArgs.filename)) || '';
          const content = (rawArgs && rawArgs.content !== undefined) ? String(rawArgs.content) : '';
          if (filePath) {
            const lines = content.split(/\r?\n/);
            const patch = [
              `--- /dev/null`,
              `+++ b/${filePath.replace(/\\/g, '/')}`,
              `@@ -0,0 +1,${lines.length} @@`,
              ...lines.map((l) => `+${l}`),
              '',
            ].join('\n');
            this.runtime.journal.append({ kind: 'tool.legacy_translated', from: name, to: 'workspace.apply_patch', trace_id: traceId });
            return this.call('workspace.apply_patch', { patch, dry_run: false }, trustedContext);
          }
        }
        if (name === 'read_file') {
          const filePath = (rawArgs && (rawArgs.path || rawArgs.file_path)) || '';
          if (filePath) {
            this.runtime.journal.append({ kind: 'tool.legacy_translated', from: name, to: 'workspace.read', trace_id: traceId });
            return this.call('workspace.read', { paths: [filePath] }, trustedContext);
          }
        }
        if (name === 'run_powershell') {
          const cmd = (rawArgs && (rawArgs.command || rawArgs.cmd || rawArgs.script)) || '';
          if (cmd) {
            this.runtime.journal.append({ kind: 'tool.legacy_translated', from: name, to: 'terminal.exec', trace_id: traceId });
            return this.call('terminal.exec', { action: 'run', program: 'powershell', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd] }, trustedContext);
          }
        }
        if (name === 'run_command' || name === 'execute_command') {
          const cmd = (rawArgs && (rawArgs.command || rawArgs.cmd || rawArgs.script)) || '';
          if (cmd) {
            const parts = cmd.trim().split(/\s+/);
            const prog = parts[0];
            const pArgs = parts.slice(1);
            this.runtime.journal.append({ kind: 'tool.legacy_translated', from: name, to: 'terminal.exec', trace_id: traceId });
            return this.call('terminal.exec', { action: 'run', program: prog, args: pArgs }, trustedContext);
          }
        }
        if (name === 'get_system_info' || name === 'get_system_health') {
          this.runtime.journal.append({ kind: 'tool.legacy_translated', from: name, to: 'ghostpc.status', trace_id: traceId });
          return this.call('ghostpc.status', {}, trustedContext);
        }
        if (name === 'list_windows' || name === 'get_open_windows') {
          this.runtime.journal.append({ kind: 'tool.legacy_translated', from: name, to: 'desktop.observe', trace_id: traceId });
          return this.call('desktop.observe', { action: 'windows' }, trustedContext);
        }

        if (this.legacyMode === 'translate' && legacy.target && legacy.enabled) {
          const merged = { ...(legacy.alias.args || {}), ...(rawArgs || {}) };
          this.runtime.journal.append({ kind: 'tool.legacy_translated', from: name, to: legacy.target.name, trace_id: traceId });
          return this.call(legacy.target.name, merged, trustedContext);
        }
        return this._error(
          traceId,
          name,
          new GhostError(
            CODES.NOT_FOUND,
            legacy.alias.tool
              ? `'${name}' es una herramienta de GhostPC v1. Su equivalente es '${legacy.alias.tool}'.`
              : `'${name}' se eliminó en GhostPC v2 y no tiene equivalente.`,
            {
              recoverable: !!legacy.alias.tool,
              remediation: [
                legacy.alias.tool ? `Usa '${legacy.alias.tool}'${legacy.alias.args ? ` con ${JSON.stringify(legacy.alias.args)}` : ''}.` : null,
                legacy.alias.note || null,
                legacy.target && !legacy.enabled ? `El perfil '${legacy.target.profile}' no está activo en la política.` : null,
              ].filter(Boolean).join(' '),
              details: { legacy_tool: name, replacement: legacy.alias.tool, migration: 'MEMORY_MIGRATION.md / TOOL_CATALOG.md' },
            }
          ),
          started
        );
      }
      return this._error(
        traceId,
        name,
        new GhostError(CODES.NOT_FOUND, `Herramienta desconocida: '${name}'.`, {
          details: { available: this.runtime.engine.enabledToolNames().sort() },
        }),
        started
      );
    }

    const impl = this.impls[name];
    if (!impl) {
      return this._error(traceId, name, new GhostError(CODES.INTERNAL, `'${name}' está en el catálogo pero no implementada.`), started);
    }

    let decision = null;
    try {
      // 2. Validación estricta de entrada.
      const args = rawArgs || {};
      assertValidInput(def.inputSchema, args, name);

      // 3. Identidad explícita.
      let authenticated = null;
      if (trustedContext && trustedContext.sessionToken) {
        authenticated = this.runtime.sessionAuthority.authenticate(trustedContext.sessionToken);
      } else if (trustedContext && trustedContext.session_id && trustedContext.user_id && trustedContext.project_id) {
        throw new GhostError(CODES.POLICY_DENIED, 'El contexto de sesión debe venir firmado por la autoridad del servidor.');
      }
      const session = authenticated ? {
        session_id: validateExternalId(authenticated.session_id, 'session_id'),
        user_id: validateExternalId(authenticated.user_id, 'user_id'),
        project_id: validateExternalId(authenticated.project_id, 'project_id'),
        permissions: authenticated.permissions || [],
        profile: authenticated.profile || null,
        policy_revision: authenticated.policy_revision,
        nonce: authenticated.nonce,
      } : { session_id: ANONYMOUS_SESSION, user_id: null, project_id: null, permissions: [], profile: null };

      const ctx = {
        runtime: this.runtime,
        dispatcher: this,
        trace_id: traceId,
        session,
        def,
        dryRun: args.dry_run === true,
        authenticated,
      };

      // 4. Efectos declarados por la propia herramienta.
      const effects = impl.effects ? await impl.effects(args, ctx) : {};

      // 5. Decisión de política.
      decision = this.runtime.engine.authorize({
        tool: name,
        toolVersion: def.version,
        declaredRisk: `R${def.risk}`,
        args,
        session,
        effects,
        approvalId: args.approval_id || null,
        dryRun: ctx.dryRun,
        summary: impl.summary ? impl.summary(args) : `${name}`,
      });
      ctx.decision = decision;

      this.runtime.journal.append({
        kind: 'tool.call',
        tool: name,
        tool_version: def.version,
        trace_id: traceId,
        session_id: session.session_id,
        project_id: session.project_id,
        risk: decision.effective_risk,
        approval: decision.approval,
        dry_run: decision.dry_run,
        args: redact.redactValue(stripEnvelope(args)),
      });

      // 6. Ejecución.
      const payload = await impl.run(args, ctx);

      const structured = {
        ok: true,
        trace_id: traceId,
        tool_version: def.version,
        risk: decision.effective_risk,
        approval: decision.approval,
        ...payload,
      };

      // 7. Conformidad con el outputSchema declarado.
      const outErrors = checkOutput(def.outputSchema, structured);
      if (outErrors.length) {
        throw new GhostError(CODES.INTERNAL, `La salida de '${name}' no cumple su outputSchema: ${outErrors.join('; ')}`, {
          details: { errors: outErrors },
        });
      }

      // 8. Cortafuegos final de secretos.
      const asText = JSON.stringify(structured);
      this.runtime.secrets.assertNoLeak(asText, `respuesta de ${name}`);

      this.runtime.metrics.record(name, { ok: true, ms: Date.now() - started });
      this.runtime.journal.append({
        kind: 'tool.result',
        tool: name,
        trace_id: traceId,
        ok: true,
        duration_ms: Date.now() - started,
        effects_summary: payload.__effects_summary || undefined,
      });

      return this._success(structured, payload, def);
    } catch (err) {
      return this._error(traceId, name, err, started, decision);
    }
  }

  _success(structured, payload, def) {
    const content = [];
    // El bloque de imagen, si lo hay, va aparte del JSON estructurado.
    if (payload.__image) {
      content.push({ type: 'image', data: payload.__image.data, mimeType: payload.__image.mimeType });
      delete structured.__image;
      delete payload.__image;
    }
    delete structured.__effects_summary;
    const text = payload.__text || JSON.stringify(structured, null, 2);
    delete structured.__text;
    content.unshift({ type: 'text', text: truncateForModel(text, this.runtime.policy.limits.output.max_chars) });
    return { content, structuredContent: structured, isError: false };
  }

  _error(traceId, name, err, started, decision = null) {
    const ghost = err instanceof GhostError ? err : new GhostError(CODES.INTERNAL, err && err.message ? err.message : String(err));
    const structured = {
      ok: false,
      trace_id: traceId,
      tool_version: BY_NAME.get(name) ? BY_NAME.get(name).version : null,
      error: ghost.code,
      message: redact.redactText(ghost.message),
      recoverable: ghost.recoverable,
      remediation: ghost.remediation || null,
      details: redact.redactValue(ghost.details || {}),
    };
    if (decision) {
      structured.risk = decision.effective_risk;
      structured.approval = decision.approval;
    }
    if (this.runtime.metrics) {
      const denied = [
        CODES.POLICY_DENIED, CODES.APPROVAL_REQUIRED, CODES.PROFILE_DISABLED, CODES.RISK_LEVEL_DISABLED,
        CODES.PATH_OUTSIDE_ROOT, CODES.PATH_DENIED, CODES.PATH_LINK_ESCAPE, CODES.COMMAND_NOT_ALLOWED,
        CODES.NET_DESTINATION_DENIED, CODES.NET_PRIVATE_ADDRESS, CODES.SECRET_NOT_ALLOWED,
      ].includes(ghost.code);
      this.runtime.metrics.record(name, { ok: false, ms: Date.now() - (started || Date.now()), denied, errorCode: ghost.code });
    }
    if (this.runtime.journal) {
      this.runtime.journal.append({
        kind: 'tool.error',
        tool: name,
        trace_id: traceId,
        error: ghost.code,
        message: ghost.message,
        recoverable: ghost.recoverable,
      });
    }
    return {
      content: [{ type: 'text', text: formatError(structured) }],
      structuredContent: structured,
      isError: true,
    };
  }
}

function stripEnvelope(args) {
  const { approval_id, ...rest } = args || {};
  return rest;
}

function formatError(s) {
  const lines = [`[${s.error}] ${s.message}`];
  if (s.remediation) lines.push(`\nQué hacer: ${s.remediation}`);
  if (s.details && Object.keys(s.details).length) {
    lines.push(`\nDetalles: ${JSON.stringify(s.details, null, 2)}`);
  }
  lines.push(`\n(trace_id: ${s.trace_id}${s.recoverable ? ', recuperable' : ', NO recuperable: no repitas la misma llamada'})`);
  return lines.join('\n');
}

function truncateForModel(text, max) {
  if (typeof text !== 'string' || text.length <= max) return text;
  return text.slice(0, max) + `\n\n… [truncado: ${text.length - max} caracteres omitidos por límite de política]`;
}

module.exports = { Dispatcher };
