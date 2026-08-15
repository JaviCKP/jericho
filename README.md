# 🏰 JERICHO (GhostPC v2): El Agente Autónomo de Escritorio Zero-Trust para ChatGPT

<p align="center">
  <img src="https://img.shields.io/badge/Protocol-Model%20Context%20Protocol%20(MCP)%202025--11--25-FF6B6B?style=for-the-badge&logo=openai&logoColor=white" alt="MCP Protocol" />
  <img src="https://img.shields.io/badge/Security-Zero--Trust%20Chokepoint-10A37F?style=for-the-badge&logo=auth0&logoColor=white" alt="Security" />
  <img src="https://img.shields.io/badge/Tests-430%2B%20Passing%20(100%25)-blue?style=for-the-badge&logo=vitest&logoColor=white" alt="Tests" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-4D4D4D?style=for-the-badge&logo=windows&logoColor=white" alt="Platform" />
  <img src="https://img.shields.io/badge/License-MIT-007ACC?style=for-the-badge" alt="License" />
</p>

<p align="center">
  <b>Conecta ChatGPT Web (<a href="https://chatgpt.com">chatgpt.com</a>) a tu ordenador con una suite agéntica de grado empresarial.</b><br>
  Visión de pantalla milimétrica, control de ratón y teclado determinista, motor de parches quirúrgicos con rollback atómico, memoria persistente estructurada con control de concurrencia y aprobaciones humanas fuera de banda.
</p>

---

```text
       ██╗███████╗██████╗ ██╗ ██████╗██╗  ██╗ ██████╗ 
       ██║██╔════╝██╔══██╗██║██╔════╝██║  ██║██╔═══██╗
       ██║█████╗  ██████╔╝██║██║     ███████║██║   ██║
  ██   ██║██╔══╝  ██╔══██╗██║██║     ██╔══██║██║   ██║
  ╚█████╔╝███████╗██║  ██║██║╚██████╗██║  ██║╚██████╔╝
   ╚════╝ ╚══════╝╚═╝  ╚═╝╚═╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝ 
            Autonomous Zero-Trust Desktop Agent Suite
```

---

## 📑 Tabla de Contenidos

1. [🌟 ¿Por qué Jericho?](#-por-qué-jericho)
2. [🏛️ Arquitectura del Sistema](#️-arquitectura-del-sistema)
3. [✨ Características Principales & Bondades](#-características-principales--bondades)
4. [🛠️ Catálogo Consolidado de Herramientas (13 Tools)](#️-catálogo-consolidado-de-herramientas-13-tools)
5. [🚀 Inicio Rápido en 60 Segundos](#-inicio-rápido-en-60-segundos)
6. [💬 Flujo de Trabajo en ChatGPT Web (Ejemplos Reales)](#-flujo-de-trabajo-en-chatgpt-web-ejemplos-reales)
7. [🎛️ Consola del Operador Humano (Human-in-the-Loop)](#️-consola-del-operador-humano-human-in-the-loop)
8. [🔒 Seguridad Zero-Trust y Defensa en Profundidad](#-seguridad-zero-trust-y-defensa-en-profundidad)
9. [📚 Documentación Técnica Detallada](#-documentación-técnica-detallada)
10. [🧪 Batería de Pruebas y Validación](#-batería-de-pruebas-y-validación)
11. [🖥️ Modos de Ejecución (Windows, macOS, Linux)](#️-modos-de-ejecución-windows-macos-linux)
12. [📄 Licencia y Créditos](#-licencia-y-créditos)

---

## 🌟 ¿Por qué Jericho?

La mayoría de los servidores MCP existentes son envoltorios básicos de comandos que ejecutan código ciego en tu sistema sin aislamiento, gastan miles de tokens y sufren de amnesia entre conversaciones.

**Jericho (GhostPC v2)** es un entorno agéntico completo diseñado bajo el estándar **Zero-Trust**:

* **🔒 Cero Puertos Abiertos:** Conexión segura saliente cifrada TLS mediante el túnel oficial de OpenAI. Tu ordenador jamás queda expuesto a Internet ni necesitas tocar el router.
* **🛡️ Chokepoint de Seguridad Central:** Ninguna herramienta puede tocar el disco, la red o el sistema operativo sin que el motor de políticas evalúe la identidad, las raíces autorizadas y el nivel de riesgo (**R0 a R4**).
* **↩️ Edición Quirúrgica con Rollback Atómico:** Olvídate de que la IA te borre archivos o deje proyectos a medias. Cada parche de código genera un `rollback_token` que permite **deshacer cualquier cambio al 100% de forma instantánea**.
* **🧠 Memoria Estructurada con Prevención de Colisiones:** Adiós a la amnesia y a los archivos de texto corruptos. Memoria versionada con *Compare-and-Swap* (`expected_revision`), detección automática de cambios en disco (*Staleness Detection*) y exigencia de evidencia de tests para dar tareas por completadas.
* **👁️ Computer Use Real y Determinista:** Capturas con cuadrícula milimétrica, soporte multimonitor nativo en Windows/macOS/Linux y precondiciones de geometría que impiden clics a ciegas.

---

## 🏛️ Arquitectura del Sistema

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        ChatGPT Web (chatgpt.com)                       │
│                        [Modo Desarrollador / MCP]                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼  HTTPS Saliente (Túnel Cifrado TLS)
┌────────────────────────────────────────────────────────────────────────┐
│                   OpenAI Secure MCP Tunnel Gateway                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼  stdio (JSON-RPC 2.0 / MCP Protocol)
┌────────────────────────────────────────────────────────────────────────┐
│                   JERICHO / GHOSTPC v2 RUNTIME                         │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │               CHOKEPOINT: POLICY ENGINE (Zero-Trust)              │  │
│  │   Identidad · Riesgos (R0-R4) · Raíces · Aprobaciones Humanas    │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │                                  │
│         ┌───────────────────────────┼──────────────────────────┐       │
│         ▼                           ▼                          ▼       │
│  ┌──────────────┐            ┌──────────────┐           ┌───────────┐  │
│  │  Workspace   │            │   Terminal   │           │  Desktop  │  │
│  │ Paths / Diff │            │ Safe Exec /  │           │ Observe / │  │
│  │ & Rollback   │            │ Allowlist    │           │ Input     │  │
│  └──────────────┘            └──────────────┘           └───────────┘  │
│         │                           │                          │       │
│         └───────────────────────────┼──────────────────────────┘       │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │        DIARIO DE AUDITORÍA CRIPTOGRÁFICO (Hash-Chained Journal)   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Tu Ordenador (Windows / macOS / Linux)                   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Características Principales & Bondades

### 1. 🧱 Jaula de Sistema de Archivos Militar
* **Confinamiento en Raíces:** El agente solo puede operar dentro de tus carpetas autorizadas (`GHOSTPC_ROOTS` o `CHATGPT_WORKSPACE`).
* **Protección contra Exploits de SO:** Bloquea *Path Traversal* (`../`), Flujos de Datos Alternativos de NTFS (ADS `file:stream`), nombres reservados de MS-DOS (`CON`, `PRN`, `AUX`, `NUL`), nombres cortos 8.3 (`PROGRA~1`), rutas de red UNC (`\\servidor\`) y escapes por *Symlinks* o *Junctions*.
* **Exclusión Innegociable de Secretos:** Bloquea el acceso a `.env*`, `.ssh/`, `.aws/`, `.gnupg/`, `id_rsa`, `.npmrc`, `.git-credentials` y certificados `.pem`/`.key` incluso si están dentro del proyecto.

### 2. ↩️ Motor de Parches con "Botón de Deshacer"
* **Simulación Segura (`dry_run: true`):** Verifica si el parche encaja antes de tocar el disco.
* **Token de Reversión (`rollback_token`):** Cada cambio genera un identificador único (`rb_123456`). Si los tests fallan, `workspace.rollback(rollback_token)` devuelve el archivo a su estado original al milímetro.
* **Control Precondicional de Hash:** Impide aplicar cambios si el archivo fue modificado externamente entre la lectura y la edición.

### 3. 🧠 Memoria de Tareas Anti-Alucinaciones
* **Compare-and-Swap Concurrente:** Cada tarea tiene un número de revisión (`revision: 1, 2...`). Dos chats de ChatGPT no pueden pisarse el trabajo accidentalmente.
* **Detección de Memoria Caducada (*Staleness*):** Al reanudar una tarea, el sistema comprueba si el código o la rama de Git cambiaron en disco fuera de la sesión e inyecta advertencias.
* **Cierre Basado en Evidencia:** El modelo **no puede** marcar una tarea como completada sin adjuntar la prueba criptográfica de que los tests reales se ejecutaron y pasaron (`PASS`).

### 4. 👤 Aprobaciones Humanas Fuera de Banda (*Human-in-the-Loop*)
* Las acciones de alto riesgo (borrado de directorios, modificaciones destructivas) pausan la ejecución y generan un `approval_id`.
* Tú apruebas desde tu terminal con `npm run approve`. La IA **no puede auto-concederse permisos**.

---

## 🛠️ Catálogo Consolidado de Herramientas (13 Tools)

Frente a servidores con docenas de micro-herramientas que agotan el contexto del modelo, Jericho v2 expone **13 herramientas ortogonales de alto rendimiento**:

| Perfil | Herramienta | Riesgo | Función Principal |
| :--- | :--- | :---: | :--- |
| **`core_read`** | `ghostpc.status` | R0 | Consulta estado, límites reales, métricas y salud del sistema. |
| **`core_read`** | `workspace.read` | R0 | Lee múltiples archivos con control de límites y checksums SHA-256. |
| **`core_read`** | `workspace.inspect` | R0 | Árboles de directorios, metadatos, permisos y estadísticas de archivos. |
| **`core_read`** | `workspace.search` | R0 | Búsqueda por texto (grep) y patrones glob dentro de raíces autorizadas. |
| **`core_read`** | `git.inspect` | R0 | Inspección de ramas, diffs, commits y estado del repositorio. |
| **`core_read`** | `memory.resume` | R0/R1 | Carga sesiones de proyecto con detección de memoria obsoleta. |
| **`development`** | `workspace.apply_patch` | R1/R3 | Aplica cambios quirúrgicos con simulación previa y token de rollback. |
| **`development`** | `workspace.rollback` | R1 | Reversión atómica instantánea de parches aplicados previamente. |
| **`development`** | `terminal.exec` | R1/R4 | Ejecución de programas permitidos (`node`, `git`, `npm`) sin inyección shell. |
| **`development`** | `verify.run` | R1 | Ejecución aislada de suites de pruebas y linters con timeout. |
| **`development`** | `git.commit` | R1 | Creación de commits locales con lista explícita de archivos. |
| **`development`** | `memory.checkpoint` | R1 | Guarda snapshots del progreso y valida evidencia de criterios. |
| **`development`** | `memory.propose_rule`| R1 | Propone reglas de proyecto que requieren validación del operador humano. |

---

## 🚀 Inicio Rápido en 60 Segundos

### 1. Clonar e Instalar

```bash
git clone https://github.com/JaviCKP/jericho.git
cd jericho
npm install
```

### 2. Configuración Asistida

Ejecuta el asistente interactivo:
```bash
npm run setup
```
*(O en Windows haz doble clic en `setup.bat`)*

El asistente te pedirá tu `CONTROL_PLANE_TUNNEL_ID` y tu `CONTROL_PLANE_API_KEY` de OpenAI y validará todo el entorno con `npm run doctor`.

### 3. Iniciar el Servidor

```bash
npm start
```
*(O ejecuta `scripts/start-silent.vbs` en Windows para ejecutarlo 100% invisible en segundo plano)*.

### 4. Conectar en ChatGPT Web

1. Ve a [https://chatgpt.com/#settings/Connectors](https://chatgpt.com/#settings/Connectors).
2. Haz clic en **Añadir aplicación / Conectar servidor MCP** (`+`).
3. Selecciona **Tunnel** y elige tu túnel de Jericho.
4. ¡Listo! Abre cualquier chat en ChatGPT y empieza a programar.

---

## 💬 Flujo de Trabajo en ChatGPT Web (Ejemplos Reales)

<details>
<summary><b>1. "¿Qué teníamos pendiente en mi PC?" (Descubrimiento y Reanudación)</b></summary>

```text
Usuario: ¿Qué tareas teníamos pendientes en mi ordenador?

ChatGPT: [Ejecuta memory.resume(action="list_projects")]
Tienes estas hojas de proyecto activas:
📦 PROYECTO: ecommerce-app
   1. [IN_PROGRESS] Carrito de Compras con Zustand (Revisión 3 · 66% completado)
   2. [PAUSED] Integración de Pasarela Stripe (Revisión 1 · Nueva)

¿Reanudamos la del carrito?
```
</details>

<details>
<summary><b>2. Edición Quirúrgica de Código con Rollback Automático</b></summary>

```text
Usuario: Añade persistencia en localStorage al carrito y ejecuta los tests.

ChatGPT: 
1. [Ejecuta workspace.apply_patch(dry_run=true)] -> Simulación exitosa.
2. [Ejecuta workspace.apply_patch] -> Aplicado en 'src/store/useCart.js' (Token: rb_9a8f12).
3. [Ejecuta verify.run(command="npm test")] -> Tests fallaron por sintaxis.
4. [Ejecuta workspace.rollback(rollback_token="rb_9a8f12")] -> Archivo restaurado al estado original.
5. He corregido el error de sintaxis y vuelto a aplicar el parche. ¡Tests 100% PASS!
```
</details>

<details>
<summary><b>3. Aprobación Humana de Acción Destructiva (Human-in-the-Loop)</b></summary>

```text
Usuario: Borra la carpeta antigua de assets temporales.

ChatGPT: 
Javi, para eliminar el directorio 'temp_assets/' el sistema de seguridad requiere 
tu autorización física fuera de banda (Acción Destructiva R3).
Por favor, abre tu terminal y ejecuta:
  npm run approve -- apr_7c3a91

Dime cuando lo tengas para proceder.

Usuario: Listo, aprobado.
ChatGPT: [Reintenta con approval_id="apr_7c3a91"] -> Directorio eliminado con éxito.
```
</details>

---

## 🎛️ Consola del Operador Humano (Human-in-the-Loop)

Como operador humano, dispones de una herramienta de control independiente para supervisar las decisiones del agente:

```bash
# 1. Resolver aprobaciones de riesgo (R3 / R4)
npm run approve -- --list             # Listar solicitudes pendientes
npm run approve -- apr_0123456789     # Aprobar operación
npm run approve -- --deny apr_0123    # Denegar operación

# 2. Gestionar reglas de memoria propuestas por la IA
npm run rules                         # Listar reglas activas y propuestas
npm run rules -- accept prop_123      # Aceptar propuesta de convención
npm run rules -- reject prop_123      # Rechazar propuesta

# 3. Auditoría e Integridad Forense
npm run audit -- verify               # Verifica la cadena de hashes criptográfica
npm run audit -- export               # Exporta el historial de eventos en JSONL

# 4. Migración de Tareas v1 -> v2
npm run migrate -- --apply            # Convierte Markdown antiguo a JSON versionado
```

---

## 🔒 Seguridad Zero-Trust y Defensa en Profundidad

| Capa de Defensa | Mecanismo Implementado | Amenaza Neutralizada |
| :--- | :--- | :--- |
| **Aislamiento de Rutas** | Canonicidad estricta y validación `isInside()` | *Path Traversal*, Symlink Escape, UNC Relay |
| **Filtro Sintáctico** | Rechazo de bytes NUL, ADS `:`, nombres DOS (`CON`) | Exploits y congelaciones de subsistema Windows |
| **Protección de Secretos** | SecretBroker con exclusión de `.env*` y redacción regex | Filtración de tokens, API keys y claves privadas SSH |
| **Anti-Inyección** | Separación binario/args sin subshells arbitrarias | Remote Code Execution por concatenación de comandos |
| **Guardia de Red** | Bloqueo de rangos privados, loopback y metadatos | Server-Side Request Forgery (SSRF) y escaneo LAN |
| **Integridad de Auditoría** | Hash-Chained Journal append-only SHA-256 | Manipulación o borrado encubierto de logs por malware |

---

## 📚 Documentación Técnica Detallada

Para auditorías de seguridad y desarrollo avanzado, consulta los manuales en el repositorio:

* 🛡️ **[`THREAT_MODEL.md`](./THREAT_MODEL.md):** Modelo de amenazas formal, análisis STRIDE y árbol de mitigaciones.
* 🏛️ **[`ARCHITECTURE_V2.md`](./ARCHITECTURE_V2.md):** Especificación técnica profunda del Runtime, Chokepoint y Dispatcher.
* 🧰 **[`TOOL_CATALOG.md`](./TOOL_CATALOG.md):** Catálogo exhaustivo de herramientas, esquemas JSON y anotaciones MCP.
* 🔄 **[`MEMORY_MIGRATION.md`](./MEMORY_MIGRATION.md):** Manual de migración del sistema de tareas v1 al motor v2.
* 📊 **[`AUDIT.md`](./AUDIT.md):** Auditoría integral de línea base y registro de vulnerabilidades cerradas.

---

## 🧪 Batería de Pruebas y Validación

Jericho cuenta con una suite de **más de 430 pruebas automatizadas**:

```bash
# Ejecutar todas las suites de prueba (Seguridad + Contratos + Evals)
npm test

# Ejecutar únicamente las pruebas de seguridad Zero-Trust
npm run test:security

# Ejecutar las pruebas de conformidad de esquemas y protocolo MCP
npm run test:contract

# Ejecutar evaluaciones de escenarios agénticos E2E
npm run test:evals

# Smoke test rápido de ciclo de vida
npm run smoke
```

---

## 🖥️ Modos de Ejecución (Windows, macOS, Linux)

### 🪟 Windows
* **Modo Consola:** `start.bat` o `npm start`.
* **Modo 100% Invisible:** Doble clic en `scripts/start-silent.vbs` (sin ventanas de terminal ni iconos en la barra).
* **Inicio con Windows:** `install-autostart.bat` (crea una tarea en el Programador de Tareas de Windows).

### 🍎 macOS
* **Configuración:** `./setup.sh`
* **Ejecución:** `./start.sh`
* **Permisos:** Concede permisos de *Accesibilidad* y *Grabación de Pantalla* a tu terminal en *Ajustes del Sistema -> Privacidad y Seguridad*.

### 🐧 Linux
* **Configuración:** `./setup.sh`
* **Ejecución:** `./start.sh`
* **Paquetes recomendados:** `sudo apt-get install wmctrl xdotool scrot` (para soporte GUI en X11).

---

## 📄 Licencia y Créditos

Distribuido bajo la licencia de código abierto **MIT**.

Diseñado y construido con ❤️ por **[JaviCKP](https://github.com/JaviCKP)**.
