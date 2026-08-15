# 🏰 JERICHO (GhostPC v2): The Zero-Trust Autonomous Desktop Agent for ChatGPT

<p align="center">
  <img src="https://img.shields.io/badge/Protocol-Model%20Context%20Protocol%20(MCP)%202025--11--25-FF6B6B?style=for-the-badge&logo=openai&logoColor=white" alt="MCP Protocol" />
  <img src="https://img.shields.io/badge/Security-Zero--Trust%20Chokepoint-10A37F?style=for-the-badge&logo=auth0&logoColor=white" alt="Security" />
  <img src="https://img.shields.io/badge/Tests-430%2B%20Passing-blue?style=for-the-badge&logo=vitest&logoColor=white" alt="Tests" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-4D4D4D?style=for-the-badge&logo=windows&logoColor=white" alt="Platform" />
  <img src="https://img.shields.io/badge/License-MIT-007ACC?style=for-the-badge" alt="License" />
</p>

<p align="center">
  <b>Conecta ChatGPT Web (<a href="https://chatgpt.com">chatgpt.com</a>) a tu ordenador con una arquitectura agéntica Zero-Trust de grado empresarial.</b><br>
  Visión y control de escritorio determinista, motor de parches con rollback atómico, terminal con prevención de inyección, memoria estructurada con control de revisiones y consola de aprobación humana (*Human-in-the-Loop*).
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

## 🌟 ¿Qué hace único a Jericho / GhostPC v2?

A diferencia de los servidores MCP convencionales que ejecutan comandos ciegamente, **Jericho v2** está construido con una arquitectura de seguridad defensiva **Zero-Trust**:

1. **🔒 Jaula de Sistema de Archivos Blindada:**  
   Resolución de rutas canónicas contra raíces autorizadas (`GHOSTPC_ROOTS`). Bloqueo estricto contra *Path Traversal*, nombres reservados de MS-DOS (`CON`, `NUL`), flujos de datos alternativos (NTFS ADS), nombres cortos 8.3 y escape por enlaces simbólicos/junctions. Exclusión innegociable de secretos (`.env*`, `.ssh/`, `.aws/`, `.pem`, `.key`).
2. **🛡️ Motor de Políticas Central (*Chokepoint*):**  
   Toda herramienta pasa por un único punto de decisión antes de tocar el sistema operativo. Clasificación formal de riesgos (**R0** a **R4**) y necesidad de confirmación humana para acciones destructivas.
3. **↩️ Motor de Parches con Rollback Atómico (`workspace.apply_patch`):**  
   Edición de código mediante *unified diffs* con simulación previa (`dry_run: true`) y generación de `rollback_token` para deshacer cualquier cambio de forma 100% limpia y atómica.
4. **🧠 Memoria Agéntica Estructurada y Versionada (`memory.*`):**  
   Control de concurrencia optimista (*Compare-and-Swap*) con revisiones (`expected_revision`), detección automática de cambios en disco (*Staleness Detection*) y exigencia de evidencia criptográfica para cerrar tareas.
5. **👤 Consola del Operador Humano (`scripts/operator.js`):**  
   Flujo de aprobación fuera de banda (*Out-of-Band*). La IA no puede auto-aprobarse permisos: tú decides desde tu terminal con `npm run approve`.
6. **📜 Diario de Auditoría Inmutable con Hash-Chaining:**  
   Registro append-only donde cada evento enlaza el hash del anterior, garantizando trazabilidad e integridad forense a prueba de manipulaciones.

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

## 📚 Documentación Técnica y Especificaciones

Para consultar todos los detalles arquitectónicos y de seguridad, consulta la documentación oficial del repositorio:

| Documento | Descripción |
| :--- | :--- |
| 🛡️ **[`THREAT_MODEL.md`](./THREAT_MODEL.md)** | Modelo de amenazas formal, análisis STRIDE, matriz de riesgo R0-R4 y mitigaciones. |
| 🏛️ **[`ARCHITECTURE_V2.md`](./ARCHITECTURE_V2.md)** | Especificación técnica de componentes, ciclo de vida del Runtime, Chokepoint y Dispatcher. |
| 🧰 **[`TOOL_CATALOG.md`](./TOOL_CATALOG.md)** | Catálogo completo de las 13 herramientas ortogonales, esquemas JSON y anotaciones MCP. |
| 🔄 **[`MEMORY_MIGRATION.md`](./MEMORY_MIGRATION.md)** | Guía de migración paso a paso de tareas v1 (Markdown) al motor de memoria estructurado v2. |
| 📊 **[`AUDIT.md`](./AUDIT.md)** | Auditoría integral de línea base y registro de vulnerabilidades mitigadas. |

---

## 🛠️ Catálogo Consolidado de Herramientas (v2)

Jericho v2 agrupa sus capacidades en **13 herramientas ortogonales y profundas** divididas en 5 perfiles:

| Perfil | Herramienta | Riesgo | Descripción |
| :--- | :--- | :---: | :--- |
| **`core_read`** | `ghostpc.status` | R0 | Describe el estado, métricas y límites reales del servidor y la política. |
| **`core_read`** | `workspace.read` | R0 | Lee múltiples archivos con control de límites y checksums SHA-256. |
| **`core_read`** | `workspace.inspect` | R0 | Inspecciona árboles de directorios, metadatos y estadísticas de archivos. |
| **`core_read`** | `workspace.search` | R0 | Búsqueda por texto y patrones glob dentro de las raíces autorizadas. |
| **`core_read`** | `git.inspect` | R0 | Inspección determinista de estado Git, ramas, logs y diffs. |
| **`core_read`** | `memory.resume` | R0/R1 | Carga sesiones de trabajo con detección de memoria obsoleta (*staleness*). |
| **`development`** | `workspace.apply_patch` | R1/R3 | Aplica cambios quirúrgicos con simulación previa (*dry-run*) y token de rollback. |
| **`development`** | `workspace.rollback` | R1 | Deshace atómicamente un parche previo utilizando su `rollback_token`. |
| **`development`** | `terminal.exec` | R1/R4 | Ejecución segura de programas permitidos (`node`, `git`, `npm`) sin inyección shell. |
| **`development`** | `verify.run` | R1 | Ejecuta suites de tests y linters con límite de recursos y timeout. |
| **`development`** | `git.commit` | R1 | Realiza commits locales estructurados indicando la lista exacta de archivos. |
| **`development`** | `memory.checkpoint` | R1 | Guarda snapshots del progreso y exige evidencia comprobada para completar tareas. |
| **`development`** | `memory.propose_rule`| R1 | Propone nuevas reglas globales que requieren aceptación del operador humano. |

---

## 🚀 Inicio Rápido

### 1. Clonar e Instalar

```bash
git clone https://github.com/JaviCKP/jericho.git
cd jericho
npm install
```

### 2. Configurar Credenciales

Ejecuta el asistente de configuración:
```bash
npm run setup
```

O crea tu archivo `.env`:
```env
CONTROL_PLANE_TUNNEL_ID="tunnel_0123456789abcdef..."
CONTROL_PLANE_API_KEY="sk-proj-..."
CHATGPT_WORKSPACE="C:\Users\tu-usuario\ChatGPT-Workspace"
```

### 3. Iniciar el Servidor

```bash
npm start
```

### 4. Conectar en ChatGPT Web

1. Abre [https://chatgpt.com/#settings/Connectors](https://chatgpt.com/#settings/Connectors).
2. Haz clic en **Añadir aplicación / Conectar servidor MCP** (`+`).
3. Selecciona **Tunnel** y elige tu túnel de Jericho.
4. ¡Listo! Abre un chat nuevo y empieza a delegar tareas con total seguridad.

---

## 🎛️ Panel de Control del Operador Humano

El operador (la persona) cuenta con una consola de comandos independiente para supervisar al agente:

```bash
# 1. Ver y resolver aprobaciones de acciones de alto riesgo (R3/R4)
npm run approve -- --list             # Ver acciones pendientes
npm run approve -- apr_0123456789     # Conceder aprobación a una acción
npm run approve -- --deny apr_0123    # Denegar una acción

# 2. Gestionar reglas globales de memoria
npm run rules                         # Listar reglas activas y propuestas
npm run rules -- accept prop_123      # Aceptar propuesta de regla del agente
npm run rules -- reject prop_123      # Rechazar propuesta

# 3. Auditoría forense y verificación de integridad
npm run audit -- verify               # Verificar la cadena criptográfica del diario
npm run audit -- export               # Exportar registro de eventos

# 4. Migrar tareas antiguas de v1 a v2
npm run migrate -- --apply            # Migra hojas Markdown al motor de memoria v2
```

---

## 🧪 Pruebas y Validación

Jericho incluye una batería de **más de 430 pruebas automatizadas** que validan la seguridad y fiabilidad del sistema en cada commit:

```bash
# Ejecutar la suite completa de pruebas
npm test

# Ejecutar únicamente las pruebas de seguridad Zero-Trust
npm run test:security

# Ejecutar el smoke test de arranque, parches, rollback y diario
npm run smoke
```

---

## 📄 Licencia

Publicado bajo la licencia de código abierto **MIT**. Creado y mantenido por **JaviCKP**.
