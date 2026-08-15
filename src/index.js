#!/usr/bin/env node
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} = require('@modelcontextprotocol/sdk/types.js');

const logger = require('./utils/logger');
const config = require('./config');

// Importar todos los módulos de herramientas
const { visionGuiTools, handleVisionGuiTool } = require('./modules/vision_gui');
const { terminalTools, handleTerminalTool } = require('./modules/terminal');
const { filesystemTools, handleFilesystemTool } = require('./modules/filesystem');
const { contextCheckpointTools, handleContextCheckpointTool } = require('./modules/context_checkpoints');
const { gitDevTools, handleGitDevTool } = require('./modules/git_dev');
const { systemProcessTools, handleSystemProcessTool } = require('./modules/system_process');
const { networkWebTools, handleNetworkWebTool } = require('./modules/network_web');

// Consolidar todas las herramientas
const ALL_TOOLS = [
  ...visionGuiTools,
  ...terminalTools,
  ...filesystemTools,
  ...contextCheckpointTools,
  ...gitDevTools,
  ...systemProcessTools,
  ...networkWebTools,
];

// Crear el servidor MCP
const server = new Server(
  {
    name: 'openpc-mcp-suite',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Registrar handler para listar herramientas
server.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.debug(`Listando ${ALL_TOOLS.length} herramientas MCP.`);
  return {
    tools: ALL_TOOLS,
  };
});

// Registrar handler para ejecutar herramientas
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  logger.info(`Llamada a herramienta: ${name}`, { args: args });

  try {
    // 1. Visión y GUI
    let result = await handleVisionGuiTool(name, args);
    if (result) return result;

    // 2. Terminal y Procesos en segundo plano
    result = await handleTerminalTool(name, args);
    if (result) return result;

    // 3. Sistema de Archivos
    result = await handleFilesystemTool(name, args);
    if (result) return result;

    // 4. Checkpoints de Contexto y Memoria
    result = await handleContextCheckpointTool(name, args);
    if (result) return result;

    // 5. Git y Control de Versiones
    result = await handleGitDevTool(name, args);
    if (result) return result;

    // 6. Sistema y Procesos
    result = await handleSystemProcessTool(name, args);
    if (result) return result;

    // 7. Red y Web
    result = await handleNetworkWebTool(name, args);
    if (result) return result;

    throw new McpError(ErrorCode.MethodNotFound, `Herramienta desconocida o no implementada: ${name}`);
  } catch (error) {
    logger.error(`Error ejecutando herramienta '${name}'`, { error: error.message, stack: error.stack });
    return {
      content: [
        {
          type: 'text',
          text: `[ERROR EN HERRAMIENTA '${name}']: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

async function run() {
  logger.info('Iniciando OpenPC-MCP Server sobre stdio...');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Servidor MCP conectado y listo para recibir peticiones.');
}

run().catch((err) => {
  logger.error('Error fatal al iniciar servidor MCP:', { error: err.message });
  process.exit(1);
});
