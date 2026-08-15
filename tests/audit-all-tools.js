const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');
const fs = require('fs');

async function runFullAudit() {
  console.log('================================================================');
  console.log('       🛡️ AUDITORÍA INTEGRAL DE PRODUCCIÓN - JERICHO MCP       ');
  console.log('================================================================\n');

  const serverPath = path.resolve(__dirname, '../src/index.js');
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
  });

  const client = new Client(
    {
      name: 'jericho-auditor',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);
  console.log('✅ [PASO 1] Conexión JSON-RPC 2.0 por stdio establecida sin corrupción de stream.');

  const toolsResponse = await client.listTools();
  const tools = toolsResponse.tools;
  console.log(`✅ [PASO 2] Descubrimiento de herramientas: ${tools.length} herramientas registradas.\n`);

  const auditResults = [];

  async function testTool(category, name, args, validator) {
    const start = Date.now();
    try {
      const res = await client.callTool({ name, arguments: args });
      const elapsed = Date.now() - start;
      const isError = res.isError || (res.content && res.content[0] && res.content[0].text && res.content[0].text.startsWith('[ERROR'));

      let passed = !isError;
      let detail = '';

      if (validator && passed) {
        const valRes = validator(res);
        if (valRes !== true) {
          passed = false;
          detail = valRes;
        }
      }

      auditResults.push({
        category,
        name,
        status: passed ? 'PASS' : 'FAIL',
        elapsedMs: elapsed,
        detail: detail || (passed ? 'OK' : res.content[0].text),
      });

      console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${category} -> ${name} (${elapsed}ms)`);
      return res;
    } catch (err) {
      auditResults.push({
        category,
        name,
        status: 'CRASH',
        elapsedMs: Date.now() - start,
        detail: err.message,
      });
      console.log(`  [CRASH] ${category} -> ${name}: ${err.message}`);
    }
  }

  console.log('--- 1. AUDITORÍA: MOTOR DE TAREAS & CONTEXTO ---');
  await testTool('TaskEngine', 'get_agent_protocol', {});
  await testTool('TaskEngine', 'save_or_update_task', {
    project: 'audit-test-project',
    taskId: '01-audit-task',
    title: 'Tarea de Prueba de Auditoría',
    objective: 'Verificar funcionamiento de persistencia',
    relevantFiles: ['package.json'],
    checklist: ['[x] Paso 1 verificado', '[ ] Paso 2'],
    activeNotes: 'Auditoría en curso',
    nextSteps: ['Completar auditoría'],
    status: 'IN_PROGRESS',
  });
  await testTool('TaskEngine', 'list_pending_tasks', { project: 'audit-test-project' });
  await testTool('TaskEngine', 'resume_task_session', { project: 'audit-test-project', taskIdOrQuery: 'audit' });
  await testTool('TaskEngine', 'memory_bank', { action: 'read_all' });
  await testTool('TaskEngine', 'memory_bank', { action: 'append_rule', section: 'Auditoría', content: 'Regla de test validada' });

  console.log('\n--- 2. AUDITORÍA: SISTEMA DE ARCHIVOS & EDICIÓN QUIRÚRGICA ---');
  const testFile = path.resolve(__dirname, '../data/audit_temp.txt');
  await testTool('Filesystem', 'write_file', { filePath: testFile, content: 'LINE1: Hello\nLINE2: Old Content\nLINE3: End' });
  await testTool('Filesystem', 'read_file', { filePath: testFile, startLine: 1, endLine: 3 });
  await testTool('Filesystem', 'edit_file_replace', { filePath: testFile, targetContent: 'LINE2: Old Content', replacementContent: 'LINE2: NEW EDITED CONTENT' });
  await testTool('Filesystem', 'search_files', { pattern: 'audit_temp.txt', searchDir: path.resolve(__dirname, '../data') });
  await testTool('Filesystem', 'grep_in_files', { query: 'NEW EDITED', searchDir: path.resolve(__dirname, '../data') });
  await testTool('Filesystem', 'get_directory_tree', { dirPath: path.resolve(__dirname, '../src'), maxDepth: 2 });
  await testTool('Filesystem', 'file_operations', { operation: 'delete', sourcePath: testFile });

  console.log('\n--- 3. AUDITORÍA: TERMINAL & PROCESOS ASÍNCRONOS ---');
  await testTool('Terminal', 'run_command', { command: 'node -v' });
  await testTool('Terminal', 'get_environment_vars', { names: ['PATH', 'NODE_ENV'] });
  const bgRes = await testTool('Terminal', 'run_background_command', { command: 'node -e "setInterval(() => console.log(\'tick\'), 500)"', taskName: 'audit-ticker' });
  let bgTaskId = null;
  try {
    const parsed = JSON.parse(bgRes.content[0].text);
    bgTaskId = parsed.taskId;
  } catch (e) {}

  if (bgTaskId) {
    await new Promise((r) => setTimeout(r, 1200));
    await testTool('Terminal', 'get_background_task_output', { taskId: bgTaskId });
    await testTool('Terminal', 'kill_background_task', { taskId: bgTaskId });
  }

  console.log('\n--- 4. AUDITORÍA: VISIÓN & CONTROL DE ESCRITORIO ---');
  await testTool('VisionGUI', 'get_screen_metrics', {});
  await testTool('VisionGUI', 'take_screenshot', { withCoordinateGrid: true });
  await testTool('VisionGUI', 'list_windows', {});
  await testTool('VisionGUI', 'mouse_move', { x: 100, y: 100 });
  await testTool('VisionGUI', 'mouse_scroll', { amount: 2 });

  console.log('\n--- 5. AUDITORÍA: SISTEMA & HARDWARE ---');
  await testTool('System', 'get_system_health', {});
  await testTool('System', 'list_processes', { maxProcesses: 10 });

  console.log('\n--- 6. AUDITORÍA: GIT & CONTROL DE VERSIONES ---');
  await testTool('Git', 'git_status', { repoPath: path.resolve(__dirname, '..') });
  await testTool('Git', 'git_log', { repoPath: path.resolve(__dirname, '..'), maxEntries: 3 });

  console.log('\n--- 7. AUDITORÍA: RED & WEB SCRAPING ---');
  await testTool('Network', 'check_port', { port: 8080, host: '127.0.0.1' });
  await testTool('Network', 'http_request', { url: 'https://jsonplaceholder.typicode.com/todos/1', method: 'GET' });

  await client.close();

  console.log('\n================================================================');
  console.log('                    📊 RESUMEN DE LA AUDITORÍA                   ');
  console.log('================================================================');

  const total = auditResults.length;
  const passed = auditResults.filter((r) => r.status === 'PASS').length;
  const failed = auditResults.filter((r) => r.status !== 'PASS').length;

  console.log(`Total Pruebas Ejecutadas: ${total}`);
  console.log(`Superadas con Éxito (PASS): ${passed}`);
  console.log(`Fallidas / Errores (FAIL):  ${failed}`);

  if (failed === 0) {
    console.log('\n🌟 RESULTADO DE AUDITORÍA: 100% PERFECTO. CERO ERRORES DETECTADOS.');
    process.exit(0);
  } else {
    console.log('\n⚠️ SE DETECTARON ERRORES QUE DEBEN SER CORREGIDOS:');
    auditResults.filter((r) => r.status !== 'PASS').forEach((f) => {
      console.log(`  - [${f.status}] ${f.category} -> ${f.name}: ${f.detail}`);
    });
    process.exit(1);
  }
}

runFullAudit().catch((err) => {
  console.error('❌ Error fatal en auditoría:', err);
  process.exit(1);
});
