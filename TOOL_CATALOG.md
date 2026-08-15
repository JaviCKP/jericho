# TOOL_CATALOG.md — Catálogo de herramientas y migración desde v1

**45 herramientas (v1) → 19 declaradas / 13 expuestas por defecto (v2).**

Cada herramienta tiene nombre estable versionado, descripción no ambigua, `inputSchema` estricto
(`additionalProperties: false`), `outputSchema`, anotaciones MCP, nivel de riesgo interno,
timeout y perfil. Verificado en `tests/contract/catalog.test.js`.

---

## 1. Envoltorio común

Toda respuesta (éxito o error) incluye:

| Campo | Siempre | Significado |
|---|---|---|
| `ok` | sí | `true` si la operación se completó |
| `trace_id` | sí | Identificador de la operación en el diario de auditoría |
| `tool_version` | sí | Versión de la herramienta que respondió |
| `risk` | si hubo decisión | Nivel efectivo aplicado |
| `approval` | si hubo decisión | `not_required` / `standing_grant` / `explicit:<id>` |
| `error` | si `ok=false` | Código tipado |
| `message` | si `ok=false` | Explicación |
| `recoverable` | si `ok=false` | `false` ⇒ **no repitas la misma llamada** |
| `remediation` | si `ok=false` | Qué hacer exactamente |
| `details` | si aplica | Contexto estructurado |

Parámetros comunes admitidos por todas: `session_id`, `project_id`.
Los que pueden requerir permiso admiten además `approval_id` y `dry_run`.

---

## 2. Perfil `core_read` (lectura local segura) — activo por defecto

| Herramienta | v | Riesgo | Timeout | Idem. | Rollback |
|---|---|---|---|---|---|
| `jericho.status` | 2.0.0 | R0 | 5 s | sí | n/a |
| `workspace.inspect` | 2.0.0 | R0 | 20 s | sí | n/a |
| `workspace.search` | 2.0.0 | R0 | 30 s | sí | n/a |
| `workspace.read` | 2.0.0 | R0 | 15 s | sí | n/a |
| `memory.resume` | 2.0.0 | R0 | 40 s | sí | n/a |
| `git.inspect` | 2.0.0 | R0 | 30 s | sí | n/a |

**`jericho.status`** — Devuelve los límites REALES: perfiles, riesgo máximo, raíces, destinos de
red, nombres de secretos, aprobaciones pendientes, métricas y actividad reciente.
Sustituye a `get_agent_protocol`: en vez de pedirle al modelo que se porte bien, le dice qué
puede hacer, porque el servidor lo aplica.

**`workspace.inspect`** — `action`: `roots` | `tree` | `stat`. `stat` devuelve `sha256`.

**`workspace.search`** — `mode`: `files` (glob) | `content` (texto o regex). Excluye
`node_modules`, `.git`, binarios y todo lo de la denylist. Marca `untrusted_content`.

**`workspace.read`** — Hasta 10 archivos, con rango de líneas. **Devuelve el `sha256` del archivo
completo**, que es lo que hay que pasar a `apply_patch` en `expected_hashes`.

**`memory.resume`** — `action`: `list_projects` | `list_items` | `load` | `history` | `rules`.
Con `load` COMPRUEBA la realidad (rama, commit, `git status`, existencia y hash de archivos,
procesos vivos, hechos volátiles caducados) y devuelve el briefing separado en
`facts_verified` / `assumptions_unverified` / `risks` / `staleness` / `next_action`,
más el `expected_revision` que necesitarás para escribir.

**`git.inspect`** — `action`: `status` | `log` | `diff` | `branches`. Sólo lectura, sin remotos.

---

## 3. Perfil `development` — activo por defecto

| Herramienta | v | Riesgo | Timeout | Destructiva | Rollback |
|---|---|---|---|---|---|
| `workspace.apply_patch` | 2.0.0 | R1 (R3 si borra) | 30 s | sólo si borra | `rollback_token` |
| `workspace.rollback` | 2.0.0 | R1 | 20 s | no | n/a |
| `terminal.exec` | 2.0.0 | R1 (R3 con secretos) | 130 s | no | n/a |
| `verify.run` | 2.0.0 | R1 | 300 s | no | n/a |
| `memory.checkpoint` | 2.0.0 | R1 | 20 s | no | historial |
| `memory.propose_rule` | 2.0.0 | R1 | 10 s | no | n/a |
| `git.commit` | 2.0.0 | R1 | 60 s | no | `git.commit(action="revert")` |

**`workspace.apply_patch`** — Diff unificado, atómico (todo o nada).
Falla de forma segura si: el hash no coincide (`PRECONDITION_HASH_MISMATCH`), un hunk encaja en
varios sitios (`PATCH_AMBIGUOUS`), el archivo no existe, la ruta sale de la raíz, el parche no
aplica limpio (`PATCH_DID_NOT_APPLY`) o se superan los límites (`LIMIT_EXCEEDED`).
`run_formatter: true` ejecuta prettier si el proyecto lo tiene.

**`terminal.exec`** — `action`: `run` | `start_background` | `logs` | `list` | `stop`.
**No es una shell.** `program` debe estar en la allowlist y `args` es una lista.
`cwd` es obligatorio. El hijo NO hereda el entorno del servidor; los secretos entran sólo por
`secret_names` y sus valores nunca vuelven. Sólo se pueden detener procesos creados por Jericho
y de la misma sesión, con verificación anti-reutilización de PID.

**`verify.run`** — `check`: `test` | `lint` | `build` | `typecheck` | `custom`.
Devuelve `evidence` con un `trace_id`: **es la única evidencia válida** para cerrar un criterio.

**`memory.checkpoint`** — `action`: `create` | `update` | `add_evidence` | `record_decision` |
`restore` | `compact`. `expected_revision` es obligatorio en las actualizaciones.
`COMPLETED` sólo si todos los criterios obligatorios tienen evidencia con `trace_id` real.

**`memory.propose_rule`** — El agente no puede cambiar reglas globales; sólo proponerlas.

**`git.commit`** — `action`: `commit` | `revert`. Exige `files` explícito (no hay `git add -A`).
El mensaje viaja como argv separado: no es inyectable. Sin operaciones contra remotos.

---

## 4. Perfil `desktop` — DESACTIVADO por defecto

| Herramienta | v | Riesgo | Timeout | Destructiva |
|---|---|---|---|---|
| `desktop.observe` | 2.0.0 | R2 (R3 si `capture_screen`) | 30 s | no |
| `desktop.element_action` | 2.0.0 | R2 | 20 s | sí (hint) |
| `desktop.keyboard` | 2.0.0 | **R3** | 20 s | sí |

Orden de preferencia: API directa > accesibilidad > selector > captura de región > coordenadas.
Jericho implementa los dos últimos con precondiciones estrictas.

**`desktop.observe`** — `windows` (id, proceso, título, geometría, foco) | `capture_window` |
`capture_region` | `capture_screen` | `metrics`. Cada captura devuelve `observation_id` con
marca temporal. `capture_screen` es R3 porque puede llevarse un gestor de contraseñas abierto.

**`desktop.element_action`** — Coordenadas **relativas a la ventana**. Exige `observation_id`
reciente y verifica que la ventana existe, con el mismo proceso, el título esperado y la misma
geometría. Si algo no cuadra, no actúa. Produce una nueva observación como postcondición.

**`desktop.keyboard`** — Exige que la ventana TENGA EL FOCO. Rechaza texto que contenga un
secreto conocido o que tenga forma de credencial. R3: requiere aprobación.

---

## 5. Perfil `network` — DESACTIVADO por defecto

| Herramienta | v | Riesgo | Timeout | Mundo abierto |
|---|---|---|---|---|
| `web.fetch_readonly` | 2.0.0 | R2 | 30 s | sí |
| `http.call_allowlisted` | 2.0.0 | R2 (R3 con datos locales) | 30 s | sí |

**`web.fetch_readonly`** — Sólo GET https público. Sin cabeceras ni cuerpo: **no sirve para
enviar nada**. Bloquea loopback, redes privadas y metadatos; revalida cada redirección.

**`http.call_allowlisted`** — Por ALIAS, no por URL. Métodos declarados por destino.
`contains_local_data: true` eleva a R3 y exige aprobación; el servidor además lo detecta por su
cuenta y rechaza la llamada si el modelo lo declaró mal.

---

## 6. Perfil `admin` — DESACTIVADO por defecto

**`admin.perform_allowlisted_action`** (R3) — Ejecuta una acción de una lista cerrada que
escribe una persona en `admin.actions`. **No acepta comandos**, sólo identificadores.
No es una terminal de administrador.

---

## 7. Migración desde los 45 nombres de v1

Si un cliente antiguo llama a un nombre v1, Jericho devuelve un error explicativo con la
equivalencia. Con `JERICHO_LEGACY_ALIASES=translate` la traducción es automática.

### Renombradas / combinadas

| v1 | v2 | Nota |
|---|---|---|
| `get_agent_protocol` | `jericho.status` | Las reglas son política del servidor, no un prompt |
| `list_pending_tasks` | `memory.resume(action="list_items")` | |
| `resume_task_session` | `memory.resume(action="load")` | Ahora verifica la realidad |
| `save_or_update_task` | `memory.checkpoint(action="update")` | Exige `expected_revision` |
| `read_file` | `workspace.read` | Devuelve `sha256`; hasta 10 archivos |
| `search_files` | `workspace.search(mode="files")` | |
| `grep_in_files` | `workspace.search(mode="content")` | |
| `get_directory_tree` | `workspace.inspect(action="tree")` | |
| `run_command` | `terminal.exec(action="run")` | Allowlist + argv, sin shell |
| `run_background_command` | `terminal.exec(action="start_background")` | Con TTL |
| `get_background_task_output` | `terminal.exec(action="logs")` | |
| `kill_background_task` | `terminal.exec(action="stop")` | |
| `list_background_tasks` | `terminal.exec(action="list")` | |
| `list_processes` | `terminal.exec(action="list")` | Sólo procesos de Jericho |
| `kill_process` | `terminal.exec(action="stop")` | Sólo procesos de Jericho, con verificación de PID |
| `git_status` / `git_log` / `git_diff` | `git.inspect` | |
| `git_commit` | `git.commit` | Exige `files`; no inyectable |
| `save_context_checkpoint` | `memory.checkpoint` | |
| `load_context_checkpoint` | `memory.resume(action="load")` | |
| `list_context_checkpoints` | `memory.resume(action="list_items")` | |
| `store_memory` | `memory.checkpoint(action="record_decision")` | |
| `recall_memory` | `memory.resume` | |
| `take_screenshot` | `desktop.observe(action="capture_window")` | Por ventana, no pantalla completa |
| `list_windows` | `desktop.observe(action="windows")` | Ahora con geometría |
| `focus_window` | `desktop.element_action(action="focus")` | |
| `mouse_click` | `desktop.element_action(action="click")` | Relativo a ventana + observación |
| `mouse_drag` | `desktop.element_action(action="drag")` | |
| `mouse_scroll` | `desktop.element_action(action="scroll")` | |
| `type_text` | `desktop.keyboard(action="type")` | Exige foco; rechaza secretos |
| `press_hotkey` | `desktop.keyboard(action="hotkey")` | |
| `get_screen_metrics` | `desktop.observe(action="metrics")` | |
| `fetch_web_page` | `web.fetch_readonly` | Contenido marcado como no fiable |
| `http_request` | `http.call_allowlisted` | Alias, no URLs libres |

### Transformadas

| v1 | v2 | Por qué |
|---|---|---|
| `write_file` | `workspace.apply_patch` | Sobrescribir sin precondición perdía cambios ajenos |
| `edit_file_replace` | `workspace.apply_patch` | Reemplazaba la 1ª de N coincidencias en silencio |
| `file_operations` (copy/move/delete) | `workspace.apply_patch` | Un diff crea y borra dentro de la raíz, con rollback |
| `memory_bank` | `memory.propose_rule` | El agente ya no puede reescribir reglas globales |
| `git_branch` | `git.inspect(action="branches")` | Crear/borrar/cambiar rama se retiró del agente |

### Eliminadas sin sustituto

| v1 | Motivo |
|---|---|
| `get_environment_vars` | Los valores de entorno nunca vuelven al modelo. `jericho.status` lista los NOMBRES de secretos disponibles |
| `open_app_or_url` | Ruta de exfiltración (abrir `https://atacante/?d=…`) y de ejecución |
| `check_port` | Primitiva de escaneo de red sin valor para desarrollo |
| `mouse_move` | Mover el cursor sin actuar no aporta y rompía el determinismo |
| `get_system_health` | Filtraba información del host sin aportar al trabajo |

### Nuevas

| Herramienta | Para qué |
|---|---|
| `jericho.status` | Conocer los límites reales antes de planificar |
| `workspace.rollback` | Deshacer un parche por completo |
| `verify.run` | Producir evidencia verificable con `trace_id` |
| `memory.propose_rule` | Proponer reglas globales sin poder aceptarlas |
| `admin.perform_allowlisted_action` | Acciones administrativas de lista cerrada |

---

## 8. Códigos de error

| Código | Recuperable | Significado |
|---|---|---|
| `POLICY_DENIED` | según caso | La política prohíbe la operación tal como se pidió |
| `APPROVAL_REQUIRED` | sí | Falta aprobación humana; `details.approval_id` |
| `APPROVAL_INVALID` | no | Aprobación inexistente, denegada, caducada, ya usada o de otra operación |
| `PROFILE_DISABLED` | no | El perfil no está activo |
| `RISK_LEVEL_DISABLED` | no | Por encima de `max_risk` |
| `PATH_OUTSIDE_ROOT` | no | Fuera de las raíces autorizadas |
| `PATH_DENIED` | no | Excluido por denylist o forma de ruta peligrosa |
| `PATH_LINK_ESCAPE` | no | Enlace o junction que cambia de raíz |
| `PATH_NOT_FOUND` | sí | No existe |
| `PRECONDITION_HASH_MISMATCH` | sí | El archivo cambió: vuelve a leerlo |
| `PATCH_AMBIGUOUS` | sí | Añade contexto al hunk |
| `PATCH_DID_NOT_APPLY` | sí | Regenera el parche |
| `REVISION_CONFLICT` | sí | Otro chat escribió: relee e integra |
| `LEASE_HELD` | sí | Otra sesión está escribiendo; reintenta |
| `EVIDENCE_MISSING` | sí | Ejecuta `verify.run` y aporta el `trace_id` |
| `SCHEMA_INVALID` | sí | Los datos no cumplen el esquema |
| `COMMAND_NOT_ALLOWED` | no | Programa, subcomando o argumento prohibido |
| `TIMEOUT` | sí | Superó el tiempo máximo |
| `PROCESS_NOT_OWNED` | no | El proceso no es de Jericho o de esta sesión |
| `CIRCUIT_OPEN` | sí | Demasiados fallos seguidos; cambia una condición |
| `NET_DESTINATION_DENIED` | no | Alias desconocido o esquema no permitido |
| `NET_METHOD_DENIED` | no | Método no declarado para ese destino |
| `NET_REDIRECT_DENIED` | no | Redirección a un destino no autorizado |
| `NET_PRIVATE_ADDRESS` | no | Loopback, red privada o metadatos |
| `NET_LIMIT_EXCEEDED` | no | Cuerpo o respuesta demasiado grandes |
| `SECRET_NOT_ALLOWED` | no | El secreto no está en `secrets.allowed` |
| `SECRET_NOT_AVAILABLE` | no | Autorizado pero no definido |
| `SECRET_VALUE_NEVER_RETURNED` | no | Se bloqueó una respuesta que contenía un secreto |
| `PRECONDITION_WINDOW` | sí | La ventana no existe, cambió de título o se movió |
| `OBSERVATION_STALE` | sí | Vuelve a observar antes de actuar |
| `ACTION_BUDGET_EXHAUSTED` | sí | Demasiadas acciones sin volver a observar |
| `INVALID_ARGUMENT` | sí | Argumentos que no cumplen el esquema |
| `LIMIT_EXCEEDED` | sí | Supera un límite de política |
| `NOT_FOUND` | según caso | Recurso, herramienta o identificador desconocido |
| `INTERNAL` | sí | Fallo inesperado (queda en el diario) |
