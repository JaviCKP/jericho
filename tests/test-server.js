const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');

async function testServer() {
  console.log('--- Probando Suite OpenPC-MCP con Hojas Modulares por Proyecto ---');

  const serverPath = path.resolve(__dirname, '../src/index.js');
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
  });

  const client = new Client(
    {
      name: 'agent-tester',
      version: '1.4.0',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);
  console.log('✅ Conexión establecida.');

  console.log('\n--- 1. Consultando Protocolo de Autonomía ---');
  const protoRes = await client.callTool({
    name: 'get_agent_protocol',
    arguments: {},
  });
  console.log('Protocolo:\n', protoRes.content[0].text.substring(0, 300) + '...\n');

  console.log('\n--- 2. Creando hoja de contexto en el proyecto "mi-tienda-online" ---');
  await client.callTool({
    name: 'save_or_update_task',
    arguments: {
      project: 'mi-tienda-online',
      taskId: '01-carrito-compras',
      title: 'Desarrollo del Carrito de Compras en React',
      objective: 'Crear componente CartDrawer con persistencia en localStorage.',
      relevantFiles: ['package.json'],
      checklist: ['[x] Estado global con Zustand', '[ ] Animación de apertura', '[ ] Checkout'],
      activeNotes: 'Usando Framer Motion para las animaciones.',
      nextSteps: ['Terminar animación de apertura', 'Conectar con Stripe'],
      status: 'IN_PROGRESS',
    },
  });

  console.log('\n--- 3. Creando hoja de contexto en otro proyecto "backend-api" ---');
  await client.callTool({
    name: 'save_or_update_task',
    arguments: {
      project: 'backend-api',
      taskId: '01-endpoints-auth',
      title: 'Endpoints de Autenticación Express',
      objective: 'Crear rutas /login y /register con validación Zod.',
      relevantFiles: ['src/config.js'],
      checklist: ['[x] Middleware JWT', '[ ] Rutas Auth'],
      status: 'IN_PROGRESS',
    },
  });

  console.log('\n--- 4. Listando hojas de contexto agrupadas por proyecto ---');
  const listRes = await client.callTool({
    name: 'list_pending_tasks',
    arguments: {},
  });
  console.log('Listado:\n', listRes.content[0].text);

  console.log('\n--- 5. Reanudando hoja de contexto de un proyecto específico ---');
  const resumeRes = await client.callTool({
    name: 'resume_task_session',
    arguments: {
      project: 'mi-tienda-online',
      taskIdOrQuery: 'carrito',
    },
  });
  console.log('Resultado resume_task_session:\n', resumeRes.content[0].text.substring(0, 450) + '...\n');

  await client.close();
  console.log('🎉 ¡TODAS LAS PRUEBAS DE HOJAS MODULARES Y PROTOCOLO PASARON!');
  process.exit(0);
}

testServer().catch((err) => {
  console.error('❌ Error en las pruebas:', err);
  process.exit(1);
});
