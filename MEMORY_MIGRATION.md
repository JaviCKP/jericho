# MEMORY_MIGRATION.md — Migración de memoria v1 → v2

## 1. Qué cambia y por qué

En v1 el estado de una tarea vivía en Markdown de formato libre que se parseaba con expresiones
regulares. Eso tenía tres consecuencias medidas en AUDIT.md:

- **P1-2** Dos chats escribían la misma hoja y el último ganaba, sin aviso ni conflicto.
- **P1-3** Una tarea pasaba a `COMPLETED` sin ninguna evidencia.
- **A3 (modelo de amenazas)** El contenido de un archivo podía fingir el estado
  (`**Estado**: COMPLETED`), porque el estado *era* ese texto.

En v2 la fuente de verdad es JSON validado con `revision`. El Markdown sigue existiendo, pero
como **vista derivada**: se regenera en cada escritura y lleva una cabecera que lo advierte.

## 2. Correspondencia

| v1 | v2 | Notas |
|---|---|---|
| `<workspace>/.tasks/<proyecto>/<tarea>.md` | `data/memory/projects/<proyecto>/items/<id>.json` | Fuente de verdad |
| — | `data/memory/projects/<proyecto>/items/<id>.md` | Vista para personas, derivada |
| — | `data/memory/projects/<proyecto>/history/<id>/rev-NNNNNN.json` | Historial completo |
| — | `data/memory/projects/<proyecto>/journal.jsonl` | Diario del proyecto, sólo append |
| — | `data/memory/projects/<proyecto>/project.json` | Configuración del proyecto |
| — | `data/memory/projects/<proyecto>/decisions/*.json` | Decisiones técnicas |
| `<workspace>/.context/MEMORY_BANK.md` | `data/memory/policy/rules.json` + `policy/proposals/` | Requiere aprobación humana |
| `data/long_term_memory.json` | decisiones del proyecto `memoria-global` | |
| `data/checkpoints/*.json` | entradas del diario del proyecto | |
| — | `data/memory/index.json` | Índice derivado, reconstruible |

## 3. Esquema del work item (v2)

```jsonc
{
  "schema_version": 2,
  "id": "arreglar-suma",          // estable, [a-z0-9._-]
  "revision": 4,                   // compare-and-swap
  "project_id": "demo",
  "status": "IN_PROGRESS",         // DRAFT|IN_PROGRESS|BLOCKED|PAUSED|COMPLETED|ABANDONED
  "title": "...",
  "goal": "...",
  "acceptance_criteria": [
    { "id": "c1", "text": "La suite de tests pasa", "mandatory": true,
      "verify": "verify.run(check=\"test\")" }
  ],
  "plan": ["..."],
  "completed_steps": ["..."],
  "next_action": "...",
  "blockers": ["..."],
  "related_files": ["demo/suma.js"],
  "branch": "main",
  "base_commit": "a1b2c3...",
  "created_at": "...", "updated_at": "...", "completed_at": null,
  "verified_facts": [
    { "text": "El servidor escucha en 3000", "volatility": "volatile",
      "verified_at": "2026-08-15T10:00:00Z" }
  ],
  "assumptions": ["..."],          // NO verificado
  "evidence": [
    { "criterion_id": "c1", "kind": "test", "result": "pass",
      "trace_id": "trc_...", "at": "...", "detail": "npm test -> exit 0" }
  ],
  "author": "ses_...", "session_id": "ses_..."
}
```

**Regla de cierre:** `COMPLETED` exige que **todos** los criterios con `mandatory !== false`
tengan al menos una evidencia con `result: "pass"` y un `trace_id` que **exista realmente en el
diario de auditoría**. El modelo no puede inventarse la evidencia: el servidor la comprueba.
Un work item sin ningún criterio obligatorio **no puede cerrarse**.

## 4. Cómo migrar

```bash
npm run migrate
```

Eso es una **simulación**: no escribe nada. Muestra cuántas hojas se migrarían, cuántas reglas
pasarían a propuestas y qué errores hay.

```bash
npm run migrate -- --apply
```

Escribe. Es **idempotente**: si un id ya existe, lo omite en lugar de sobrescribir.

Resultado sobre los datos reales de esta instalación (simulación):

```
Hojas .tasks encontradas : 5
  migradas               : 5
  omitidas (ya existían) : 0
  con error              : 0
MEMORY_BANK.md           : sí (10 reglas como PROPUESTAS)
long_term_memory.json    : 1 entradas -> 1 decisiones
checkpoints              : 1 -> 1
```

## 5. Decisiones de la migración

### 5.1 Las tareas `COMPLETED` de v1 se migran como `PAUSED`
En v1 el estado era texto libre sin ninguna evidencia. Migrarlas como `COMPLETED` reintroduciría
exactamente P1-3. Cada una recibe un bloqueo explícito:

> MIGRACIÓN: esta hoja figuraba COMPLETED en v1 sin evidencia verificable. Se migró como PAUSED.
> Añade criterios obligatorios y evidencia real antes de cerrarla.

Los pasos marcados `[x]` se conservan en `completed_steps`: no se pierde información.

### 5.2 Los checklists se migran como criterios OPCIONALES
Nada migrado tiene evidencia verificable. Marcarlos obligatorios dejaría todas las tareas
imposibles de cerrar. Quedan como `mandatory: false` hasta que alguien los revise.

### 5.3 `MEMORY_BANK.md` se migra como PROPUESTAS, no como reglas
En v1 cualquier contenido podía escribir ahí sin aprobación (P0-6), así que su contenido **no es
de fiar por construcción**. Revísalas:

```bash
npm run rules -- list
npm run rules -- accept <proposal_id>
npm run rules -- reject <proposal_id>
```

### 5.4 Todo el texto migrado entra como `assumptions`
Se marca explícitamente que no está verificado, para que el agente no lo trate como hecho.

## 6. Reversión

La migración es **aditiva**: no borra ni modifica `.tasks/`, `.context/`,
`data/long_term_memory.json` ni `data/checkpoints/`.

Para revertir:

```bash
rm -rf data/memory
```

Cada work item migrado conserva su origen en `migrated_from.source_path`, así que se puede
rastrear de dónde vino cada uno.

## 7. Trabajar con la memoria v2

### Reanudar
```jsonc
memory.resume({ action: "load", project_id: "demo", id: "arreglar-suma",
                session_id: "ses_mi_chat" })
```
Devuelve el briefing con `staleness` (qué ha cambiado desde la última sesión) y el
`expected_revision` que necesitarás para escribir.

### Escribir
```jsonc
memory.checkpoint({ action: "update", project_id: "demo", id: "arreglar-suma",
                    expected_revision: 4,          // OBLIGATORIO
                    next_action: "...", session_id: "ses_mi_chat" })
```
Si otro chat escribió entre medias: `REVISION_CONFLICT` con la revisión real. Relee, integra
y reintenta. **Nunca se pierde trabajo en silencio.**

### Cerrar
```jsonc
// 1. verificar de verdad
const v = verify.run({ check: "test", cwd: "demo", session_id: "ses_mi_chat" })
// 2. cerrar con el trace_id que devolvió
memory.checkpoint({ action: "update", project_id: "demo", id: "arreglar-suma",
                    expected_revision: 5, status: "COMPLETED",
                    evidence: [{ ...v.evidence, criterion_id: "c1" }],
                    session_id: "ses_mi_chat" })
```

### Recuperar de una corrupción
```jsonc
memory.resume({ action: "history", project_id: "demo", id: "arreglar-suma" })
memory.checkpoint({ action: "restore", project_id: "demo", id: "arreglar-suma", revision: 4 })
```
`restore` crea una **revisión nueva** con el contenido antiguo: no borra historia.

### Compactar
```jsonc
memory.checkpoint({ action: "compact", project_id: "demo" })
```
Genera `journal-compact.json`. **El diario original se conserva intacto.**

## 8. Cambios incompatibles

1. `save_or_update_task` ya no existe; `memory.checkpoint` exige `expected_revision`.
2. `memory_bank(action="update_section")` ya no existe: el agente no puede escribir reglas.
3. El estado ya no se lee del Markdown. Editar el `.md` a mano no cambia nada.
4. `COMPLETED` exige evidencia con `trace_id` real.
5. Los ids se normalizan a `[a-z0-9._-]`; los que no cumplían se convierten con `slugify`.
6. Un work item sin criterios obligatorios no se puede cerrar (antes se podía).
