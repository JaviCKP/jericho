const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');

async function testServer() {
  console.log('--- Iniciando prueba completa de OpenPC-MCP Agentic Engine ---');

  const serverPath = path.resolve(__dirname, '../src/index.js');
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
  });

  const client = new Client(
    {
      name: 'agent-tester',
      version: '1.3.0',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);
  console.log('✅ Conexión con OpenPC-MCP establecida con éxito.');

  console.log('\n--- 1. Guardando tarea rica con archivos relevantes vinculados ---');
  const saveRes = await client.callTool({
    name: 'save_or_update_task',
    arguments: {
      taskId: 'sistema-autenticacion',
      title: 'Desarrollo de Autenticación con JWT y SQLite',
      project: path.resolve(__dirname, '..'),
      objective: 'Implementar endpoints de registro y login con hashing bcrypt y validación de tokens.',
      relevantFiles: [
        'package.json',
        'src/config.js',
      ],
      checklist: [
        '[x] Configurar dependencias de seguridad',
        '[/] Crear middleware de validación JWT',
        '[ ] Escribir tests unitarios',
      ],
      activeNotes: 'Decisión arquitectónica: Usar tokens HMAC-SHA256 con expiración de 15 minutos.',
      nextSteps: [
        'Implementar función verifyToken() en el middleware',
        'Probar endpoint de login con curl',
      ],
      status: 'IN_PROGRESS',
    },
  });
  console.log('Resultado save_or_update_task:\n', saveRes.content[0].text);

  console.log('\n--- 2. Listando tareas pendientes en el sistema ---');
  const listRes = await client.callTool({
    name: 'list_pending_tasks',
    arguments: {},
  });
  console.log('Resultado list_pending_tasks:\n', listRes.content[0].text);

  console.log('\n--- 3. Reanudando sesión de tarea con precarga de archivos y Git ---');
  const resumeRes = await client.callTool({
    name: 'resume_task_session',
    arguments: {
      taskIdOrQuery: 'autenticacion',
      includeFilePreviews: true,
    },
  });
  console.log('Resultado resume_task_session:\n', resumeRes.content[0].text);

  await client.close();
  console.log('\n🎉 ¡PRUEBA AGÉNTICA COMPLETADA CON ÉXITO!');
  process.exit(0);
}

testServer().catch((err) => {
  console.error('❌ Error en las pruebas:', err);
  process.exit(1);
});
