#!/usr/bin/env node
'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
  LATEST_PROTOCOL_VERSION,
} = require('@modelcontextprotocol/sdk/types.js');

const config = require('./config');
const logger = require('./utils/logger');
const { createRuntime, recover } = require('./core/runtime');
const { Dispatcher } = require('./tools/dispatch');
const { IMPLEMENTATIONS } = require('./tools');
const { PROFILES } = require('./tools/profiles');
const { RESOURCES, listResources, listResourceTemplates, readResource } = require('./server/resources');
const { PROMPTS, getPrompt } = require('./server/prompts');
const { SERVER_INSTRUCTIONS } = require('./server/instructions');
const redact = require('./core/redact');

/**
 * Servidor MCP de Jericho v2.
 *
 * Diferencias clave con v1:
 *  - Las herramientas se exponen por PERFIL, no todas a la vez.
 *  - Toda llamada pasa por el PolicyEngine antes de ejecutarse.
 *  - Se declaran resources y prompts, y se negocia la versión de protocolo:
 *    a un cliente antiguo no se le envían campos que no entiende.
 */

/** Versiones anteriores a esta no admiten outputSchema ni structuredContent. */
const STRUCTURED_SINCE = '2025-06-18';

function supportsStructured(version) {
  if (!version) return false;
  // Las versiones son fechas ISO: la comparación lexicográfica es correcta.
  return version >= STRUCTURED_SINCE;
}

async function main() {
  logger.setLogLevel(config.logLevel);

  const runtime = createRuntime({
    env: process.env,
    controlDir: config.controlDir,
    policyFile: config.policyFile,
    journalDir: config.journalDir,
    approvalsDir: config.approvalsDir,
    processStateFile: config.processStateFile,
    memoryDir: config.memoryDir,
    profiles: PROFILES,
  });

  for (const w of runtime.policyWarnings) logger.warn(`[política] ${w}`);

  const recovery = await recover(runtime);
  logger.info('Recuperación al arrancar', {
    temporales: recovery.temp_files_removed,
    procesos_huerfanos: recovery.orphans.recovered,
    procesos_matados: recovery.orphans.killed,
    no_verificables: recovery.orphans.unverifiable,
    aprobaciones_caducadas: recovery.approvals_expired,
    cadena_diario_valida: recovery.journal_chain.valid,
    memoria: recovery.memory,
  });
  if (!recovery.journal_chain.valid) {
    logger.error('LA CADENA DEL DIARIO DE AUDITORÍA NO VERIFICA', recovery.journal_chain);
  }

  const legacyMode = (process.env.JERICHO_LEGACY_ALIASES || 'explain').toLowerCase();
  const dispatcher = new Dispatcher(runtime, IMPLEMENTATIONS, { legacyMode });

  const server = new Server(
    { name: config.serverName, version: config.serverVersion },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true },
        prompts: {},
        logging: {},
      },
      instructions: SERVER_INSTRUCTIONS(runtime),
    }
  );

  /** Versión de protocolo negociada; se captura interceptando el initialize. */
  let negotiatedVersion = null;
  const mcpTrustedContext = () => {
    const token = process.env.JERICHO_MCP_SESSION_TOKEN;
    if (!token) return null;
    try { return runtime.sessionAuthority.authenticate(token); } catch (e) { return null; }
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = dispatcher.listTools();
    if (supportsStructured(negotiatedVersion)) return { tools };
    // Cliente antiguo: se retiran campos que no entiende para no romper su validación.
    return {
      tools: tools.map(({ outputSchema, _meta, ...rest }) => ({
        ...rest,
        description: `${rest.description}\n\n[Jericho ${_meta['jericho/version']} · riesgo ${_meta['jericho/risk']}]`,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const token = process.env.JERICHO_MCP_SESSION_TOKEN;
    const result = await dispatcher.call(name, args, token ? { sessionToken: token } : null);
    if (supportsStructured(negotiatedVersion)) return result;
    // Cliente antiguo: sólo contenido textual.
    const { structuredContent, ...rest } = result;
    return rest;
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => listResources(runtime, mcpTrustedContext()));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => listResourceTemplates());
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => readResource(runtime, request.params.uri, mcpTrustedContext()));
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const context = mcpTrustedContext();
    if (!context) throw new Error('Prompt sensible requiere contexto autenticado fuera de banda.');
    return getPrompt(runtime, request.params.name, { ...(request.params.arguments || {}), project_id: context.project_id, session_id: context.session_id });
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Interceptar el initialize para conocer la versión negociada sin
  // reimplementar el handler del SDK.
  const innerOnMessage = transport.onmessage;
  transport.onmessage = (message, extra) => {
    try {
      if (message && message.method === 'initialize' && message.params) {
        const requested = message.params.protocolVersion;
        negotiatedVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
        runtime.journal.append({
          kind: 'client.initialize',
          requested_protocol: requested,
          negotiated_protocol: negotiatedVersion,
          structured_supported: supportsStructured(negotiatedVersion),
          client: message.params.clientInfo,
        });
        logger.info('Cliente conectado', {
          protocolo: negotiatedVersion,
          structuredContent: supportsStructured(negotiatedVersion),
          cliente: message.params.clientInfo,
        });
      }
    } catch (e) {
      logger.warn('No se pudo registrar el initialize', { error: e.message });
    }
    return innerOnMessage(message, extra);
  };

  logger.info('Jericho listo', {
    version: config.serverVersion,
    perfiles: runtime.policy.profiles,
    herramientas: dispatcher.listTools().length,
    raices: runtime.roots.list().map((r) => r.name),
    secretos_conocidos_redactados: runtime.knownSecrets,
    politica: runtime.policySource,
  });

  // Barrido periódico de procesos caducados y aprobaciones vencidas.
  const sweeper = setInterval(async () => {
    try {
      await runtime.registry.sweepExpired();
      runtime.approvals.gc();
    } catch (e) {
      logger.warn('Fallo en el barrido periódico', { error: e.message });
    }
  }, 60_000);
  sweeper.unref();

  const shutdown = async (signal) => {
    logger.info(`Apagando por ${signal}: deteniendo procesos gestionados…`);
    try {
      await runtime.registry.killAll('shutdown');
      runtime.journal.append({ kind: 'server.stopped', signal });
    } catch (e) {
      /* mejor esfuerzo */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  // Los errores de arranque también se redactan: pueden contener rutas y valores.
  logger.error('Error fatal al iniciar Jericho', { error: redact.redactText(err.message), stack: redact.redactText(err.stack || '') });
  process.exit(1);
});
