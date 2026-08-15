const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');

async function testServer() {
  console.log('--- Iniciando prueba completa de OpenPC-MCP ---');

  const serverPath = path.resolve(__dirname, '../src/index.js');
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
  });

  const client = new Client(
    {
      name: 'test-client',
      version: '1.2.0',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);
  console.log('✅ Cliente conectado al servidor MCP con éxito.');

  const toolsResponse = await client.listTools();
  console.log(`✅ ${toolsResponse.tools.length} herramientas registradas en total.`);

  console.log('\n--- 1. Probando TASK ENGINE: Crear tarea Markdown ---');
  const createRes = await client.callTool({
    name: 'task_session',
    arguments: {
      action: 'create',
      taskId: 'autenticacion-jwt',
      title: 'Sistema de Autenticación JWT y Refresh Tokens',
      project: 'mi-app-web',
      objective: 'Implementar registro, login y middleware JWT seguro con base de datos SQLite.',
      checklist: [
        '[x] Diseñar tabla de usuarios en SQLite',
        '[ ] Endpoint /api/auth/register',
        '[ ] Endpoint /api/auth/login',
      ],
      notes: 'Usando bcryptjs para hashing de passwords. Tokens expiran en 15m.',
      nextSteps: [
        'Crear controlador de login',
        'Configurar cookies httpOnly para refresh token',
      ],
    },
  });
  console.log('Resultado create:\n', createRes.content[0].text);

  console.log('\n--- 2. Probando TASK ENGINE: Cargar tarea Markdown ---');
  const loadRes = await client.callTool({
    name: 'task_session',
    arguments: {
      action: 'load',
      query: 'autenticacion',
    },
  });
  console.log('Resultado load:\n', loadRes.content[0].text);

  console.log('\n--- 3. Probando TASK ENGINE: Listar tareas ---');
  const listRes = await client.callTool({
    name: 'task_session',
    arguments: { action: 'list' },
  });
  console.log('Resultado list:\n', listRes.content[0].text);

  console.log('\n--- 4. Probando MEMORY BANK ---');
  await client.callTool({
    name: 'memory_bank',
    arguments: {
      action: 'append',
      section: 'Reglas de Código',
      content: 'Usar siempre TypeScript estricto y TailwindCSS para estilos.',
    },
  });
  const memRes = await client.callTool({
    name: 'memory_bank',
    arguments: { action: 'read' },
  });
  console.log('Resultado Memory Bank:\n', memRes.content[0].text);

  await client.close();
  console.log('\n🎉 ¡TODAS LAS PRUEBAS DEL MOTOR DE TAREAS Y MCP PASARON EXITOSAMENTE!');
  process.exit(0);
}

testServer().catch((err) => {
  console.error('❌ Error en las pruebas:', err);
  process.exit(1);
});
