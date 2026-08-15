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

// Importar los módulos de herramientas
const { visionGuiTools, handleVisionGuiTool } = require('./modules/vision_gui');
const { terminalTools, handleTerminalTool } = require('./modules/terminal');
const { filesystemTools, handleFilesystemTool } = require('./modules/filesystem');
const { taskEngineTools, handleTaskEngineTool } = require('./modules/task_engine');
const { contextCheckpointTools, handleContextCheckpointTool } = require('./modules/context_checkpoints');
const { gitDevTools, handleGitDevTool } = require('./modules/git_dev');
const { systemProcessTools, handleSystemProcessTool } = require('./modules/system_process');
const { networkWebTools, handleNetworkWebTool } = require('./modules/network_web');

// Consolidar todas las herramientas disponibles
const ALL_TOOLS = [
  ...taskEngineTools,        // 1. Motor de Tareas en Markdown & Memory Bank (Prioridad #1)
  ...visionGuiTools,         // 2. Visión de Pantalla y Control de Escritorio
  ...terminalTools,          // 3. Terminal PowerShell / Background Tasks
  ...filesystemTools,        // 4. Edición Quirúrgica de Código y Búsqueda
  ...contextCheckpointTools, // 5. Checkpoints de Contexto
  ...gitDevTools,            // 6. Operaciones Git
  ...systemProcessTools,     // 7. Rendimiento de Sistema
  ...networkWebTools,        // 8. Web Scraping & Red
];

// Crear el servidor MCP
const server = new Server(
  {
    name: 'openpc-mcp-suite',
    version: '1.2.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handler para listar herramientas
server.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.debug(`Listando ${ALL_TOOLS.length} herramientas MCP.`);
  return {
    tools: ALL_TOOLS,
  };
});

// Handler para ejecutar herramientas
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  logger.info(`Llamada a herramienta: ${name}`, { args: args });

  try {
    // 1. Motor de Tareas en Markdown y Memory Bank
    let result = await handleTaskEngineTool(name, args);
    if (result) return result;

    // 2. Visión y GUI
    result = await handleVisionGuiTool(name, args);
    if (result) return result;

    // 3. Terminal y Tareas en segundo plano
    result = await handleTerminalTool(name, args);
    if (result) return result;

    // 4. Sistema de Archivos y Edición de Código
    result = await handleFilesystemTool(name, args);
    if (result) return result;

    // 5. Checkpoints de Contexto
    result = await handleContextCheckpointTool(name, args);
    if (result) return result;

    // 6. Git y Control de Versiones
    result = await handleGitDevTool(name, args);
    if (result) return result;

    // 7. Sistema y Procesos
    result = await handleSystemProcessTool(name, args);
    if (result) return result;

    // 8. Red y Web
    result = await handleNetworkWebTool(name, args);
    if (result) return result;

    throw new McpError(ErrorCode.MethodNotFound, `Herramienta desconocida o no implementada: ${name}`);
  } catch (error) {
    logger.error(`Error ejecutando herramienta '${name}'`, { error: error.message });
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
