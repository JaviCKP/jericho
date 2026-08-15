'use strict';

const fs = require('fs');
const path = require('path');
const diffLib = require('diff');
const { GhostError, CODES } = require('../errors');
const { writeFileAtomic, sha256Text } = require('../atomic');

/**
 * Motor de parches atómico.
 *
 * Sustituye a `edit_file_replace`, que reemplazaba silenciosamente la PRIMERA de
 * N coincidencias idénticas, sin hash previo, sin dry-run y sin rollback (P1-4).
 *
 * Garantías:
 *  - Precondición de hash: si el archivo cambió desde que lo leíste, se aborta.
 *  - Ambigüedad: si un hunk encaja en más de un sitio, se aborta.
 *  - Todo o nada: se aplica en memoria primero; si un solo archivo falla, no se
 *    escribe ninguno.
 *  - Rollback: se guarda el contenido previo y se puede restaurar.
 *  - Límites de archivos y bytes.
 */

/** Divide un diff unificado multi-archivo en trozos por archivo. */
function splitUnifiedDiff(patchText) {
  const parsed = diffLib.parsePatch(patchText);
  if (!parsed.length) {
    throw new GhostError(CODES.INVALID_ARGUMENT, 'El parche no contiene ningún diff unificado válido.', {
      recoverable: true,
      remediation: 'Usa formato unified diff con cabeceras --- a/ruta y +++ b/ruta.',
    });
  }
  return parsed;
}

const DEV_NULL = /^(\/dev\/null|[ab]\/\/dev\/null)$/;

function targetPathOf(filePatch) {
  // En un borrado, `+++` es /dev/null: el archivo real está en `---`.
  // Sin esto se intentaría resolver "/dev/null" como ruta del workspace.
  const nuevo = (filePatch.newFileName || '').trim();
  const viejo = (filePatch.oldFileName || '').trim();
  const raw = DEV_NULL.test(nuevo) ? viejo : nuevo || viejo;
  return raw.replace(/^[ab]\//, '').replace(/^"+|"+$/g, '').trim();
}

/**
 * Comprueba que un hunk no encaja en varios sitios distintos del archivo.
 * `diff.applyPatch` aplica en la primera posición compatible, así que sin esta
 * comprobación un parche ambiguo se aplicaría en el lugar equivocado.
 */
function detectAmbiguity(content, filePatch) {
  const lines = content.split('\n');
  const ambiguous = [];
  for (const hunk of filePatch.hunks) {
    const context = hunk.lines
      .filter((l) => l.startsWith(' ') || l.startsWith('-'))
      .map((l) => l.slice(1));
    if (context.length < 2) continue; // demasiado corto para juzgar
    let matches = 0;
    for (let i = 0; i + context.length <= lines.length; i++) {
      let hit = true;
      for (let j = 0; j < context.length; j++) {
        if (lines[i + j] !== context[j]) {
          hit = false;
          break;
        }
      }
      if (hit) matches++;
      if (matches > 1) break;
    }
    if (matches > 1) {
      ambiguous.push({
        old_start: hunk.oldStart,
        matches: '>1',
        preview: context.slice(0, 3).join(' ⏎ ').slice(0, 160),
      });
    }
  }
  return ambiguous;
}

/**
 * Aplica un parche unificado.
 *
 * @param {object} opts
 * @param {string} opts.patch                 diff unificado
 * @param {Roots} opts.roots
 * @param {string} [opts.root]                nombre de raíz para rutas relativas
 * @param {Object<string,string>} [opts.expected_hashes]  ruta -> sha256 esperado
 * @param {boolean} [opts.dryRun]
 * @param {number} opts.maxFiles
 * @param {number} opts.maxBytes
 * @returns {object} resultado estructurado
 */
function applyPatch({ patch, roots, root, expected_hashes = {}, dryRun = false, maxFiles, maxBytes }) {
  const filePatches = splitUnifiedDiff(patch);

  if (filePatches.length > maxFiles) {
    throw new GhostError(
      CODES.LIMIT_EXCEEDED,
      `El parche toca ${filePatches.length} archivos; el límite es ${maxFiles}.`,
      { details: { files: filePatches.length, limit: maxFiles }, remediation: 'Divide el cambio en parches más pequeños.' }
    );
  }
  if (Buffer.byteLength(patch) > maxBytes) {
    throw new GhostError(CODES.LIMIT_EXCEEDED, `El parche ocupa ${Buffer.byteLength(patch)} bytes; el límite es ${maxBytes}.`);
  }

  const staged = [];
  const problems = [];

  for (const fp of filePatches) {
    const rel = targetPathOf(fp);
    if (!rel) {
      problems.push({ file: '(desconocido)', code: CODES.INVALID_ARGUMENT, detail: 'El diff no indica un archivo destino.' });
      continue;
    }

    let resolved;
    try {
      resolved = roots.resolve(rel, { root, forWrite: true });
    } catch (err) {
      problems.push({ file: rel, code: err.code, detail: err.message });
      continue;
    }

    const isDelete = DEV_NULL.test((fp.newFileName || '').trim());
    const isCreate = DEV_NULL.test((fp.oldFileName || '').trim()) || !resolved.exists;

    let before = '';
    if (resolved.exists) {
      try {
        before = fs.readFileSync(resolved.absolute, 'utf-8');
      } catch (err) {
        problems.push({ file: resolved.relative, code: CODES.PATH_DENIED, detail: `no se puede leer: ${err.code}` });
        continue;
      }
    } else if (!isCreate) {
      problems.push({ file: resolved.relative, code: CODES.PATH_NOT_FOUND, detail: 'el archivo no existe y el parche no lo crea' });
      continue;
    }

    // Precondición de hash: detecta que otro chat (o la persona) tocó el archivo.
    const expected = expected_hashes[rel] || expected_hashes[resolved.relative];
    const actualHash = resolved.exists ? sha256Text(before) : null;
    if (expected) {
      if (expected !== actualHash) {
        problems.push({
          file: resolved.relative,
          code: CODES.PRECONDITION_HASH_MISMATCH,
          detail: `el archivo cambió desde que lo leíste (esperado ${expected.slice(0, 12)}…, actual ${actualHash ? actualHash.slice(0, 12) + '…' : 'no existe'})`,
        });
        continue;
      }
    }

    if (isDelete) {
      staged.push({
        path: resolved.relative,
        absolute: resolved.absolute,
        operation: 'delete',
        before,
        after: null,
        before_hash: actualHash,
        after_hash: null,
      });
      continue;
    }

    if (resolved.exists) {
      const ambiguous = detectAmbiguity(before, fp);
      if (ambiguous.length) {
        problems.push({
          file: resolved.relative,
          code: CODES.PATCH_AMBIGUOUS,
          detail: `el hunk encaja en más de un sitio del archivo (${ambiguous.length} hunk(s) ambiguos)`,
          hunks: ambiguous,
        });
        continue;
      }
    }

    const after = diffLib.applyPatch(before, fp);
    if (after === false) {
      problems.push({
        file: resolved.relative,
        code: CODES.PATCH_DID_NOT_APPLY,
        detail: 'el parche no aplica limpiamente sobre el contenido actual',
      });
      continue;
    }

    staged.push({
      path: resolved.relative,
      absolute: resolved.absolute,
      operation: resolved.exists ? 'modify' : 'create',
      before,
      after,
      before_hash: actualHash,
      after_hash: sha256Text(after),
      lines_added: countLines(fp, '+'),
      lines_removed: countLines(fp, '-'),
    });
  }

  // TODO O NADA: si algo falla, no se escribe nada.
  if (problems.length) {
    throw new GhostError(
      problems.length === 1 ? problems[0].code : CODES.PATCH_DID_NOT_APPLY,
      `El parche no se aplicó: ${problems.length} problema(s). No se ha modificado ningún archivo.`,
      {
        recoverable: true,
        details: { problems, staged_ok: staged.map((s) => s.path) },
        remediation:
          'Vuelve a leer los archivos afectados (workspace.read devuelve el sha256), regenera el parche ' +
          'con contexto suficiente y reintenta indicando expected_hashes.',
      }
    );
  }

  const totalBytes = staged.reduce((n, s) => n + (s.after ? Buffer.byteLength(s.after) : 0), 0);
  if (totalBytes > maxBytes) {
    throw new GhostError(CODES.LIMIT_EXCEEDED, `El resultado ocuparía ${totalBytes} bytes; el límite es ${maxBytes}.`);
  }

  const preview = staged.map((s) => ({
    path: s.path,
    operation: s.operation,
    lines_added: s.lines_added || 0,
    lines_removed: s.lines_removed || 0,
    before_sha256: s.before_hash ? s.before_hash.slice(0, 16) : null,
    after_sha256: s.after_hash ? s.after_hash.slice(0, 16) : null,
  }));

  if (dryRun) {
    return {
      applied: false,
      dry_run: true,
      files: preview,
      rollback_token: null,
      message: 'Simulación correcta: el parche aplicaría limpiamente. Vuelve a llamar con dry_run=false para escribir.',
    };
  }

  // Escritura atómica archivo a archivo, con rollback si alguna falla.
  const written = [];
  const rollback = staged.map((s) => ({ absolute: s.absolute, before: s.before, existed: s.before_hash !== null }));
  try {
    for (const s of staged) {
      if (s.operation === 'delete') {
        fs.unlinkSync(s.absolute);
      } else {
        writeFileAtomic(s.absolute, s.after);
      }
      written.push(s.path);
    }
  } catch (err) {
    // Rollback de lo ya escrito.
    for (const r of rollback) {
      try {
        if (r.existed) writeFileAtomic(r.absolute, r.before);
        else if (fs.existsSync(r.absolute)) fs.unlinkSync(r.absolute);
      } catch (e) {
        /* mejor esfuerzo */
      }
    }
    throw new GhostError(CODES.INTERNAL, `Fallo escribiendo el parche: ${err.message}. Se revirtieron los cambios ya escritos.`, {
      details: { written_before_failure: written },
    });
  }

  return {
    applied: true,
    dry_run: false,
    files: preview,
    rollback_state: rollback.map((r) => ({ absolute: r.absolute, existed: r.existed, before: r.before })),
    message: `Parche aplicado a ${written.length} archivo(s).`,
  };
}

/** Restaura el estado previo guardado por applyPatch. */
function rollbackPatch(rollbackState) {
  const restored = [];
  const failed = [];
  for (const r of rollbackState || []) {
    try {
      if (r.existed) {
        writeFileAtomic(r.absolute, r.before);
      } else if (fs.existsSync(r.absolute)) {
        fs.unlinkSync(r.absolute);
      }
      restored.push(path.basename(r.absolute));
    } catch (err) {
      failed.push({ file: r.absolute, error: err.message });
    }
  }
  return { restored, failed };
}

function countLines(filePatch, sign) {
  let n = 0;
  for (const h of filePatch.hunks) {
    for (const l of h.lines) if (l.startsWith(sign)) n++;
  }
  return n;
}

module.exports = { applyPatch, rollbackPatch, splitUnifiedDiff, detectAmbiguity };
