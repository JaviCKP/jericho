const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');

async function testServer() {
  console.log('--- Iniciando prueba de cliente MCP ---');

  const serverPath = path.resolve(__dirname, '../src/index.js');
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
  });

  const client = new Client(
    {
      name: 'test-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);
  console.log('✅ Cliente conectado al servidor MCP con éxito.');

  const toolsResponse = await client.listTools();
  console.log(`✅ ${toolsResponse.tools.length} herramientas registradas en total:`);

  toolsResponse.tools.forEach((t, i) => {
    console.log(`   ${i + 1}. [${t.name}] - ${t.description.substring(0, 70)}...`);
  });

  console.log('\n--- Probando herramienta get_system_health ---');
  const healthRes = await client.callTool({
    name: 'get_system_health',
    arguments: {},
  });
  console.log('Resultado get_system_health:\n', healthRes.content[0].text);

  console.log('\n--- Probando herramienta save_context_checkpoint ---');
  const cpRes = await client.callTool({
    name: 'save_context_checkpoint',
    arguments: {
      title: 'Checkpoint de prueba inicial',
      project: 'chatgpt-pc-mcp',
      summary: 'Todos los módulos MCP inicializados y validados con éxito.',
      nextSteps: ['Completar scripts de onboarding', 'Documentar README.md'],
    },
  });
  console.log('Resultado save_context_checkpoint:\n', cpRes.content[0].text);

  console.log('\n--- Probando recall_memory y store_memory ---');
  await client.callTool({
    name: 'store_memory',
    arguments: {
      key: 'tema_favorito',
      value: 'Oscuro con acentos verdes',
      tags: ['ui', 'preferencias'],
    },
  });
  const memRes = await client.callTool({
    name: 'recall_memory',
    arguments: { query: 'tema' },
  });
  console.log('Resultado recall_memory:\n', memRes.content[0].text);

  await client.close();
  console.log('\n🎉 ¡TODAS LAS PRUEBAS UNITARIAS PASARON EXITOSAMENTE!');
  process.exit(0);
}

testServer().catch((err) => {
  console.error('❌ Error en las pruebas:', err);
  process.exit(1);
});
