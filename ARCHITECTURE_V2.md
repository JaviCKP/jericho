# ARCHITECTURE_V2.md — Arquitectura de Jericho v2

## 1. La arquitectura anterior (v1), en una frase

Un servidor MCP con 45 herramientas que envolvían directamente `fs`, `child_process` y `fetch`,
sin ninguna capa de decisión entre el modelo y el sistema operativo, y cuya "seguridad" era un
prompt (`get_agent_protocol`) que pedía buen comportamiento.

```
ChatGPT ──stdio──► index.js ──► 8 módulos ──► fs / child_process / fetch / nut-js
                     │
                     └── switch(name) → primer módulo que responda
```

Sin política, sin identidad, sin auditoría, sin límites, sin esquemas de salida.
El estado vivía en un `Map` en memoria y en Markdown de formato libre.

## 2. La arquitectura nueva

```
ChatGPT ──stdio──► src/index.js
                     │  negociación de protocolo · resources · prompts · instructions
                     ▼
              src/tools/dispatch.js  ◄── ÚNICO camino a cualquier efecto
                     │
   1. validar entrada (esquema estricto, additionalProperties:false)
   2. derivar identidad explícita (session_id, project_id)  ── nunca la conexión
   3. impl.effects(args) ── qué va a pasar realmente
   4. ══════ PolicyEngine.authorize() ══════  ← deniega / pide aprobación
   5. impl.run(args, ctx)
   6. validar salida contra outputSchema
   7. cortafuegos de secretos + redacción
   8. diario + métricas
                     │
       ┌─────────────┼─────────────┬──────────────┬─────────────┐
       ▼             ▼             ▼              ▼             ▼
   Roots         ExecRunner   NetworkGuard   SecretBroker   MemoryStore
   (jail de      (allowlist   (alias +       (nombres,      (CAS,
    rutas)        + argv)      DNS + IP)      nunca valores) atómico)
       │             │             │              │             │
       └─────────────┴─────────────┴──────────────┴─────────────┘
                                   ▼
                     Journal (append-only, cadena de hashes)
```

### Regla estructural del chokepoint

Ninguna implementación de herramienta puede importar `child_process`, usar `fetch`,
`fs.writeFileSync`, borrar archivos, leer `process.env` ni resolver rutas con `path.resolve`.
**No es una convención: es una prueba.** `tests/contract/catalog.test.js` lo verifica sobre el
código fuente de `src/tools/impl/*.js` (50 comprobaciones).

## 3. Mapa de directorios

```
src/
  index.js                  servidor MCP: transporte, negociación, resources, prompts
  config.js                 rutas y directorio de CONTROL (fuera de las raíces)
  server/
    instructions.js         guía para el modelo (NO es el mecanismo de seguridad)
    resources.js            jericho://policy | memory/index | rules | activity | approvals
    prompts.js              4 flujos seleccionables por la persona
  core/
    risk.js                 R0..R4
    errors.js               errores tipados con recoverable + remediation
    ids.js                  trace_id, session_id, huella de operación
    redact.js               redacción por valor conocido + por forma
    atomic.js               escritura atómica, lectura segura, leases, sweep
    git.js                  fachada Git con argv fijo (sin cadena de shell)
    runtime.js              construye y recupera todo el sistema
    policy/
      defaults.js           política compilada + HARD_CEILINGS + INVARIANTS
      loader.js             carga, valida y falla cerrado
      engine.js             PolicyEngine: el único punto de decisión
      approvals.js          aprobaciones fuera de banda, un solo uso, con huella
    workspace/paths.js      jail: canonicalización, enlaces, UNC, ADS, denylist
    exec/
      program.js            allowlist, resolución, validación de argv, entorno mínimo
      runner.js             timeout, topes, concurrencia, redacción
      registry.js           propiedad, TTL, huérfanos, anti-reutilización de PID
    net/guard.js            alias, DNS, rangos privados, redirecciones, egreso
    secrets/broker.js       nombres sí, valores nunca
    audit/
      journal.js            JSONL encadenado con fsync + verify() + export()
      metrics.js            métricas por herramienta + circuit breaker
    memory/
      schema.js             esquema v2 + regla de evidencia para COMPLETED
      store.js              CAS, historial, leases, índice, recuperación
      resume.js             detección de estado obsoleto contra la realidad
      migrate.js            v1 -> v2, aditiva y reversible
      render.js             vista Markdown derivada (no fuente de verdad)
    patch/apply.js          diff unificado atómico con hash, ambigüedad y rollback
    desktop/observe.js      ventanas con geometría, captura nativa, observaciones
  tools/
    catalog.js              19 herramientas con esquemas, anotaciones, riesgo, timeout
    profiles.js             5 perfiles + tabla de migración desde los 45 nombres v1
    validate.js             validador de JSON Schema (subconjunto) que SÍ aplica strict
    dispatch.js             la tubería descrita arriba
    impl/*.js               implementaciones, sin acceso directo al sistema
scripts/operator.js         consola de la PERSONA: approve | rules | migrate | audit
tests/                      430 pruebas + 7 evaluaciones end-to-end
```

## 4. Decisiones y por qué

### 4.1 Perfiles en vez de "todas las herramientas"
45 herramientas en un solo perfil obligaban al modelo a razonar sobre capacidades que casi nunca
necesita. Ahora hay 5 perfiles y por defecto se exponen 13 herramientas (`core_read` +
`development`). `desktop`, `network` y `admin` se activan a mano.

### 4.2 Programa + argv en vez de shell
El 100% de las inyecciones de comandos del prototipo venían de construir cadenas de shell.
La solución no es escapar mejor: es no construir la cadena. `terminal.exec` recibe `program`
(de una allowlist) y `args` (una lista). En Windows, los lanzadores `.cmd` de npm/npx/yarn/pnpm
se resuelven a su `*-cli.js` y se ejecutan con `node`, dejando `cmd.exe` **completamente fuera**.

### 4.3 Parches en vez de buscar/reemplazar
`edit_file_replace` cambiaba silenciosamente la primera de N coincidencias. `workspace.apply_patch`
usa diff unificado con precondición de hash, detección de ambigüedad, aplicación todo-o-nada y
`rollback_token`.

### 4.4 La memoria es JSON, el Markdown es una vista
En v1 el estado se parseaba con expresiones regulares del Markdown, así que **el contenido de un
archivo podía cambiar el estado percibido de una tarea**. Ahora la fuente es JSON validado con
`revision`; el `.md` se regenera en cada escritura y lleva una cabecera que lo dice.

### 4.5 La conexión MCP no es la identidad
`session_id` es un parámetro explícito de cada herramienta. Sin él, la sesión es anónima y queda
limitada a R1. Así los procesos, los leases y el diario se atribuyen correctamente aunque el
transporte se reconecte.

### 4.6 Aprobación fuera de banda
El canal que pide el permiso no puede concederlo. La persona ejecuta `npm run approve -- <id>`
en su teclado. La aprobación es de un solo uso y va ligada a la huella SHA-256 de
`(herramienta, argumentos)` — excluyendo `approval_id`, que por definición cambia entre el
intento y el reintento.

### 4.7 Concesiones permanentes para no cansar a nadie
Un sistema que pregunta por todo acaba con las confirmaciones desactivadas. Por eso hay
`standing_grants` acotadas por herramienta, riesgo máximo, método y condición
(p. ej. "sólo si todos los secretos pedidos ya están en `secrets.allowed`").
Resultado medido: un ciclo completo de desarrollo pide **0 aprobaciones**; el escenario de
ataque bloquea **todo**.

### 4.8 Riesgo declarado + riesgo derivado
El catálogo declara un riesgo base; `PolicyEngine.deriveRisk()` lo puede **elevar** según los
efectos reales (borra archivos, envía datos del equipo, usa secretos…). Nunca lo rebaja, y un
argumento del modelo no puede influir a la baja.

### 4.9 Captura nativa en Windows
`screenshot-desktop` genera un `.bat` que invoca un `.exe` del directorio actual; con
`NoDefaultCurrentDirectoryInExePath=1` (habitual en entornos endurecidos) falla. Jericho captura
con `System.Drawing.CopyFromScreen` vía PowerShell: menos dependencias, captura directa de la
región pedida y coordenadas de pantalla virtual (monitores con origen negativo funcionan solos).

## 5. Ciclo de vida

**Arranque:** redacción → diario → política (falla cerrado) → raíces → subsistemas → recuperación
(temporales huérfanos, procesos huérfanos verificados, aprobaciones caducadas, cadena del diario,
memoria corrupta) → conexión stdio.

**Cada llamada:** los 8 pasos del §2.

**Apagado:** `SIGINT`/`SIGTERM` → se detienen todos los procesos gestionados → `server.stopped`
en el diario.

**Barrido periódico (60 s):** procesos caducados por TTL + aprobaciones vencidas.

## 6. Compatibilidad MCP

| Versión negociada | Comportamiento |
|---|---|
| `2025-11-25`, `2025-06-18` | `outputSchema` + `structuredContent` + `annotations` completos |
| `2025-03-26`, `2024-11-05`, `2024-10-07` | Se retira `outputSchema` de `tools/list` y `structuredContent` de las respuestas; la versión y el riesgo se anexan a la descripción; el resultado textual sigue siendo completo |
| Desconocida | Cae a la más reciente soportada |

Verificado con un cliente JSON-RPC propio en `tests/contract/protocol.test.js` (19/19).

**Extensión MCP Tasks:** NO implementada. El SDK 1.30.0 la soporta, pero las operaciones largas
de Jericho ya se resuelven con `terminal.exec(action="start_background")` + `logs`, que además
persiste entre reinicios. Adoptarla exigiría duplicar el modelo de estado. Queda documentado
como decisión, no como olvido.

## 7. Limitaciones conocidas de la arquitectura

1. **GUI sin árbol de accesibilidad.** Se implementan los niveles 4 (captura de región) y 5
   (coordenadas relativas a ventana verificada). Los niveles 2 y 3 (UI Automation, selectores)
   requerirían una dependencia nativa adicional.
2. **Sin cuotas de CPU/memoria** (Job Objects / cgroups).
3. **`rollback_token` vive en memoria** y no sobrevive a un reinicio (dura 1 hora). El rollback
   duradero es `git.commit(action="revert")`.
4. **El índice de memoria se reconstruye completo** en cada escritura. Con miles de work items
   habría que hacerlo incremental.
5. **La verificación de `trace_id`** recorre el diario y cachea por llamada. Con diarios muy
   grandes convendría un índice.
