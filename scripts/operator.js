#!/usr/bin/env node
'use strict';

/**
 * Consola del OPERADOR (la persona).
 *
 * Es deliberadamente un proceso APARTE del servidor MCP: el agente no tiene
 * ninguna forma de invocar esto. Aquí es donde una persona:
 *   - aprueba o deniega operaciones de riesgo,
 *   - acepta o rechaza propuestas de reglas globales,
 *   - migra la memoria v1 -> v2,
 *   - verifica y exporta el diario de auditoría.
 *
 * Uso:
 *   npm run approve -- <approval_id>        aprobar una operación
 *   npm run approve -- --list               ver pendientes
 *   npm run approve -- --deny <approval_id> denegar
 *   npm run rules   -- list|accept <id>|reject <id>
 *   npm run migrate -- [--apply]            migrar memoria v1 -> v2 (por defecto en seco)
 *   npm run audit   -- verify|export|tail
 */

const os = require('os');
const path = require('path');
const config = require('../src/config');
const { createRuntime } = require('../src/core/runtime');
const { PROFILES } = require('../src/tools/profiles');
const { migrate } = require('../src/core/memory/migrate');

function buildRuntime() {
  return createRuntime({
    env: process.env,
    controlDir: config.controlDir,
    policyFile: config.policyFile,
    journalDir: config.journalDir,
    approvalsDir: config.approvalsDir,
    processStateFile: config.processStateFile,
    memoryDir: config.memoryDir,
    profiles: PROFILES,
  });
}

function whoami() {
  try {
    return `${os.userInfo().username}@${os.hostname()}`;
  } catch (e) {
    return 'operator';
  }
}

function cmdApprove(runtime, argv) {
  const { approvals } = runtime;

  if (argv.includes('--list') || argv.length === 0) {
    const pending = approvals.listPending();
    if (!pending.length) {
      console.log('No hay aprobaciones pendientes.');
      return 0;
    }
    console.log(`\n${pending.length} aprobación(es) pendiente(s):\n`);
    for (const a of pending) {
      console.log(`  ${a.approval_id}`);
      console.log(`    herramienta : ${a.tool}   [riesgo ${a.risk}]`);
      console.log(`    qué hará    : ${a.reason}`);
      console.log(`    resumen     : ${a.summary}`);
      console.log(`    sesión      : ${a.session_id || '(anónima)'}   proyecto: ${a.project_id || '-'}`);
      console.log(`    caduca      : ${a.expires_at}`);
      console.log(`    argumentos  : ${JSON.stringify(a.args_redacted).slice(0, 300)}`);
      console.log(`    aprobar     : npm run approve -- ${a.approval_id}`);
      console.log(`    denegar     : npm run approve -- --deny ${a.approval_id}`);
      console.log('');
    }
    return 0;
  }

  const denyIdx = argv.indexOf('--deny');
  const approve = denyIdx === -1;
  const id = approve ? argv[0] : argv[denyIdx + 1];
  if (!id) {
    console.error('Falta el approval_id.');
    return 1;
  }
  const pending = approvals.listPending().find((a) => a.approval_id === id);
  if (!pending) {
    console.error('No hay una solicitud pendiente con ese approval_id.');
    return 1;
  }
  const operatorSecret = process.env.JERICHO_OPERATOR_SECRET;
  if (!operatorSecret) {
    console.error('JERICHO_OPERATOR_SECRET no está configurado; no se puede autenticar el canal de operador.');
    return 1;
  }
  const signature = require('crypto').createHmac('sha256', operatorSecret).update(`${id}:${pending.nonce}:${approve ? 'approve' : 'deny'}`).digest('hex');
  const rec = approvals.decide(id, approve, whoami(), {
    channel: 'operator',
    authenticated: true,
    acl: ['approval:decide'],
    nonce: pending.nonce,
    signature,
  });
  console.log(`${approve ? 'APROBADA' : 'DENEGADA'}: ${rec.approval_id} (${rec.tool}, ${rec.risk})`);
  if (approve) {
    console.log('El agente ya puede repetir la llamada con approval_id="' + rec.approval_id + '".');
    console.log('Es de un solo uso y sólo vale para esa operación exacta.');
  }
  return 0;
}

function cmdRules(runtime, argv) {
  const { memory } = runtime;
  const sub = argv[0] || 'list';

  if (sub === 'list') {
    const rules = memory.getGlobalRules();
    const pending = memory.listRuleProposals();
    console.log(`\nReglas ACEPTADAS (${rules.rules.length}):`);
    for (const r of rules.rules) console.log(`  - ${r.text}   [${r.accepted_at} por ${r.accepted_by}]`);
    console.log(`\nPropuestas PENDIENTES (${pending.length}) — NO son reglas todavía:`);
    for (const p of pending) {
      console.log(`  ${p.proposal_id}`);
      console.log(`    texto  : ${p.text}`);
      console.log(`    motivo : ${p.rationale || '(sin justificar)'}`);
      console.log(`    sesión : ${p.proposed_by_session || '(anónima)'}   trace: ${p.trace_id || '-'}`);
      console.log(`    aceptar: npm run rules -- accept ${p.proposal_id}`);
      console.log('');
    }
    if (pending.length) {
      console.log('AVISO: revisa el origen de cada propuesta. Una regla puede haber sido sugerida por');
      console.log('contenido no fiable (una web, un README) que el agente leyó.');
    }
    return 0;
  }

  if (sub === 'accept' || sub === 'reject') {
    const id = argv[1];
    if (!id) {
      console.error('Falta el proposal_id.');
      return 1;
    }
    const p = memory.decideRuleProposal(id, sub === 'accept', whoami());
    console.log(`${p.status}: ${p.proposal_id}\n  ${p.text}`);
    return 0;
  }

  console.error(`Subcomando desconocido: ${sub} (usa list | accept <id> | reject <id>)`);
  return 1;
}

function cmdMigrate(runtime, argv) {
  const apply = argv.includes('--apply');
  const report = migrate({
    store: runtime.memory,
    workspaceDir: config.workspaceDir,
    dataDir: config.dataDir,
    dryRun: !apply,
  });

  console.log(`\n=== MIGRACIÓN DE MEMORIA v1 -> v2 ${apply ? '(APLICADA)' : '(SIMULACIÓN)'} ===\n`);
  console.log(`Hojas .tasks encontradas : ${report.tasks.found}`);
  console.log(`  migradas               : ${report.tasks.migrated}`);
  console.log(`  omitidas (ya existían) : ${report.tasks.skipped_existing}`);
  console.log(`  con error              : ${report.tasks.errors.length}`);
  for (const e of report.tasks.errors) console.log(`    - ${e.file}: ${e.error}`);
  console.log(`MEMORY_BANK.md           : ${report.memory_bank.found ? 'sí' : 'no'} (${report.memory_bank.rules_proposed} reglas como PROPUESTAS)`);
  console.log(`long_term_memory.json    : ${report.long_term_memory.found} entradas -> ${report.long_term_memory.migrated} decisiones`);
  console.log(`checkpoints              : ${report.checkpoints.found} -> ${report.checkpoints.migrated}`);
  console.log(`proyectos                : ${report.projects.join(', ') || '(ninguno)'}`);
  for (const n of report.notes) console.log(`\nNOTA: ${n}`);
  console.log(`\nReversible: ${report.reversible}`);
  console.log(report.rollback_instructions);
  if (!apply) console.log('\nEsto ha sido una SIMULACIÓN. Ejecuta con --apply para escribir.');
  return 0;
}

function cmdAudit(runtime, argv) {
  const sub = argv[0] || 'verify';
  if (sub === 'verify') {
    const res = runtime.journal.verify();
    console.log(`Cadena del diario: ${res.valid ? 'ÍNTEGRA' : 'ROTA'}`);
    console.log(`  entradas: ${res.entries}`);
    if (!res.valid) {
      console.log(`  rota en la entrada ${res.brokenAt}: ${res.reason}`);
      console.log('  Esto significa que alguien editó o borró registros de auditoría.');
      return 2;
    }
    return 0;
  }
  if (sub === 'tail') {
    const n = Number(argv[1]) || 30;
    for (const e of runtime.journal.tail(n)) {
      console.log(`${e.ts}  ${String(e.kind).padEnd(22)} ${e.tool || ''} ${e.risk || ''} ${e.error || ''} ${e.trace_id || ''}`);
    }
    return 0;
  }
  if (sub === 'export') {
    const target = argv[1] || path.join(config.dataDir, `audit-export-${Date.now()}.json`);
    const res = runtime.journal.export(target);
    console.log(`Exportadas ${res.entries} entradas a ${res.file} (cadena válida: ${res.chain_valid})`);
    return 0;
  }
  console.error(`Subcomando desconocido: ${sub} (usa verify | tail [n] | export [archivo])`);
  return 1;
}

function main() {
  const [, , command, ...argv] = process.argv;
  const runtime = buildRuntime();

  let code;
  switch (command) {
    case 'approve':
      code = cmdApprove(runtime, argv);
      break;
    case 'rules':
      code = cmdRules(runtime, argv);
      break;
    case 'migrate':
      code = cmdMigrate(runtime, argv);
      break;
    case 'audit':
      code = cmdAudit(runtime, argv);
      break;
    default:
      console.log('Comandos: approve | rules | migrate | audit');
      console.log('  npm run approve -- --list');
      console.log('  npm run approve -- <approval_id>');
      console.log('  npm run rules   -- list');
      console.log('  npm run migrate -- --apply');
      console.log('  npm run audit   -- verify');
      code = 1;
  }
  process.exit(code);
}

main();
