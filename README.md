# ⚡ GhostPC (OpenPC-MCP): El Puente Autónomo entre ChatGPT y tu Ordenador

<p align="center">
  <img src="https://img.shields.io/badge/Protocol-Model%20Context%20Protocol%20(MCP)-FF6B6B?style=for-the-badge&logo=openai&logoColor=white" alt="MCP Protocol" />
  <img src="https://img.shields.io/badge/ChatGPT-Web%20%26%20Developer%20Mode-10A37F?style=for-the-badge&logo=openai&logoColor=white" alt="ChatGPT" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-4D4D4D?style=for-the-badge&logo=windows&logoColor=white" alt="Platform" />
  <img src="https://img.shields.io/badge/License-MIT-007ACC?style=for-the-badge" alt="License" />
</p>

<p align="center">
  <b>Convierte tu ChatGPT Web (<a href="https://chatgpt.com">chatgpt.com</a>) en un verdadero agente autónomo de ingeniería de software para tu ordenador.</b><br>
  Visión de escritorio en tiempo real, ratón, teclado, terminal PowerShell/Bash, edición quirúrgica de código y <b>memoria persistente estructurada en hojas Markdown modulares</b>.
</p>

---

```text
    ██████╗ ██╗  ██╗ ██████╗ ███████╗████████╗██████╗  ██████╗
   ██╔════╝ ██║  ██║██╔═══██╗██╔════╝╚══██╔══╝██╔══██╗██╔════╝
   ██║  ███╗███████║██║   ██║███████╗   ██║   ██████╔╝██║     
   ██║   ██║██╔══██║██║   ██║╚════██║   ██║   ██╔═══╝ ██║     
   ╚██████╔╝██║  ██║╚██████╔╝███████║   ██║   ██║     ╚██████╗
    ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝   ╚═╝   ╚═╝      ╚═════╝
          Autonomous Desktop Agent Engine for ChatGPT
```

---

## 🌟 ¿Por qué GhostPC?

La mayoría de los servidores MCP son simples envoltorios de comandos básicos. **GhostPC** es una suite agéntica completa diseñada para resolver los 3 grandes problemas de la IA en local:

1. **🔒 Cero Puertos Abiertos (Seguridad Total):** Utiliza el *OpenAI Secure MCP Tunnel* oficial. Conexión saliente cifrada TLS sin abrir puertos en tu router ni exponer tu IP pública.
2. **👁️ Computer Use Real (Visión + Coordenadas):** Capturas de pantalla PNG de alta resolución con **cuadrícula milimétrica superpuesta** para que ChatGPT localice y pulse botones con precisión subpíxel.
3. **🧠 Memoria Agéntica y Amnesia Cero:** Organiza tus proyectos en **Hojas de Contexto Modulares en Markdown (`.tasks/<proyecto>/<tarea>.md`)**. Cuando abres un nuevo chat en ChatGPT, solo dices *"vamos con la tarea X"* y el modelo precarga el objetivo, el checklist y el código fuente sin empezar de cero.

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
                                    ▼  Conexión Saliente (Sin tocar Firewall)
┌────────────────────────────────────────────────────────────────────────┐
│                      ghostpc daemon (tunnel-client)                    │
│                 Panel Local: http://127.0.0.1:8080/ui                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼  stdio (JSON-RPC 2.0)
┌────────────────────────────────────────────────────────────────────────┐
│                         GhostPC Core Engine                            │
├───────────────────────────────────┬────────────────────────────────────┤
│  👁️ Visión & GUI (Screenshots/DPI) │  ⚡ Terminal PowerShell / Background│
│  🧠 Motor de Tareas Modulares (.md)│  📁 Edición Quirúrgica de Código   │
│  🐙 Git & Control de Versiones    │  📊 Rendimiento Hardware (CPU/RAM) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Tu Ordenador (Windows / macOS / Linux)               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Inicio Rápido (En 60 Segundos)

### 1. Clonar el repositorio

```bash
git clone https://github.com/TU_USUARIO/GhostPC.git
cd GhostPC
npm install
```

### 2. Ejecutar el Asistente Automático

En Windows, haz doble clic en **`setup.bat`** (o ejecuta en terminal `npm run setup`).

```text
================================================================
   🚀 GHOSTPC SUITE - ASISTENTE DE CONFIGURACIÓN RÁPIDA
================================================================
1. Introduce tu CONTROL_PLANE_TUNNEL_ID: tunnel_0123456789...
2. Introduce tu CONTROL_PLANE_API_KEY: sk-proj-...
✅ Binarios oficiales descargados.
✅ Perfil de túnel generado.
✅ Diagnóstico validado: 8/8 comprobaciones superadas (PASS).
```

### 3. Conectar en ChatGPT Web

1. Abre [https://chatgpt.com/#settings/Connectors](https://chatgpt.com/#settings/Connectors).
2. Haz clic en **Añadir aplicación / Conectar servidor MCP** (`+`).
3. Selecciona **Tunnel** y elige tu túnel.
4. ¡Listo! Abre un nuevo chat y empieza a delegar tareas en tu PC.

---

## 🧠 El Motor de Tareas Modulares (`.tasks/`)

En lugar de notas gigantescas y desordenadas, GhostPC organiza el trabajo por **proyectos y hojas modulares**:

```text
ChatGPT-Workspace/.tasks/
├── mi-tienda-online/
│   ├── 01-carrito-compras.md     # Hoja de contexto del componente Cart
│   ├── 02-pasarela-stripe.md     # Hoja de contexto de pagos y webhooks
│   └── ARCHITECTURE.md           # Decisiones arquitectónicas
│
└── backend-api/
    ├── 01-endpoints-auth.md      # Endpoints de login/registro
    └── 02-migracion-db.md        # Esquemas de base de datos
```

### 📄 Anatomía de una Hoja de Contexto Viva

```markdown
# Tarea: Carrito de Compras en React
**ID**: `01-carrito-compras`
**Estado**: `IN_PROGRESS`
**Proyecto**: `mi-tienda-online`
**Actualizado**: `2026-08-15 13:40`

## 🎯 Objetivo & Alcance
Crear componente CartDrawer con persistencia en localStorage y animaciones.

## 📁 Archivos Relevantes
- `src/components/CartDrawer.jsx`
- `src/store/useCartStore.js`

## 📋 Checklist de Ejecución
- [x] Estado global con Zustand
- [/] Animación de apertura con Framer Motion
- [ ] Conectar checkout con backend

## 🧠 Contexto Activo & Decisiones Técnicas
Usamos Zustand en lugar de Redux por simplicidad. La sincronización se guarda en 'cart_v1'.

## ⏭️ Próximos Pasos para la Siguiente Sesión
1. Terminar animación del drawer
2. Escribir test unitario de añadir/eliminar producto
```

---

## 💬 Flujo de Trabajo en ChatGPT (Ejemplos Reales)

<details>
<summary><b>1. "¿Qué teníamos pendiente en mi PC?" (Descubrimiento)</b></summary>

```text
Usuario: ¿Qué tareas teníamos pendientes en mi ordenador?

ChatGPT: [Ejecuta list_pending_tasks]
Tienes estas hojas de contexto activas:
📦 PROYECTO: mi-tienda-online (.tasks/mi-tienda-online/)
   1. [IN_PROGRESS] Carrito de Compras en React (33% completado)
   2. [PAUSED] Pasarela Stripe (0% - Nueva)
¿Con cuál nos ponemos hoy?
```
</details>

<details>
<summary><b>2. "Vamos con la del carrito" (Carga y Precarga de Código)</b></summary>

```text
Usuario: Vamos con la del carrito de compras.

ChatGPT: [Ejecuta resume_task_session(project="mi-tienda-online", taskIdOrQuery="carrito")]
¡Perfecto Javi! He cargado la hoja de contexto:
- Objetivo: Carrito con Zustand y animaciones.
- Archivos clave precargados en memoria: src/components/CartDrawer.jsx (45 líneas).
- Git: Rama 'feature/cart', 1 archivo modificado sin commit.
- Próximo paso: Terminar la animación del drawer. Voy a editar el archivo y lanzar el dev server.
```
</details>

<details>
<summary><b>3. Programación, Testing y Verificación Visual</b></summary>

```text
ChatGPT: 
1. He aplicado la edición quirúrgica en 'src/components/CartDrawer.jsx'.
2. He lanzado el servidor de desarrollo en segundo plano ('npm run dev').
3. [Ejecuta take_screenshot(withCoordinateGrid=true)]
He capturado la pantalla de tu navegador: veo que el carrito se abre suavemente desde la derecha y muestra los productos con el total actualizado.
4. [Ejecuta save_or_update_task]
He actualizado la hoja de contexto marcando como completada la animación.
```
</details>

---

## 🛠️ Herramientas de Primera Clase

| Categoría | Herramientas | Qué resuelven |
| :--- | :--- | :--- |
| **🧠 Memory & Tasks** | `list_pending_tasks`, `resume_task_session`, `save_or_update_task`, `memory_bank`, `get_agent_protocol` | Cero amnesia entre chats. Hojas de contexto modulares por proyecto con precarga de código fuente. |
| **👁️ Computer Use** | `take_screenshot`, `mouse_click`, `mouse_move`, `mouse_drag`, `mouse_scroll`, `type_text`, `press_hotkey`, `focus_window` | Visión nativa con cuadrícula de coordenadas, clics exactos y control del ratón y teclado. |
| **⚡ Terminal** | `run_command`, `run_background_command`, `get_background_task_output`, `kill_background_task` | PowerShell y Bash con métricas de salida, servidores en segundo plano y lectura de logs en streaming. |
| **📁 Filesystem** | `read_file`, `write_file`, `edit_file_replace`, `search_files`, `grep_in_files`, `get_directory_tree` | Edición quirúrgica de bloques sin reescribir archivos enormes y búsqueda regex sin basura de `node_modules`. |
| **🐙 Git & Sistema** | `git_status`, `git_diff`, `git_commit`, `get_system_health`, `list_processes`, `open_app_or_url` | Control total del ciclo de vida de desarrollo y monitorización de hardware (CPU/RAM/Discos). |

---

## 🖥️ Modos de Ejecución en Windows

- **Modo Consola (Primer plano):** Doble clic en **`start.bat`** (ideal para desarrollo y logs en directo).
- **Modo 100% Invisible (Segundo plano):** Doble clic en **`scripts/start-silent.vbs`** (cero ventanas, cero pestañas).
- **Modo Inicio Automático (Como Administrador):** Doble clic en **`install-autostart.bat`** (arranca con Windows con privilegios elevados sin ventanas emergentes de UAC).

---

## 🔒 Seguridad

- **Conexión Saliente:** No requiere abrir puertos en tu router ni exponer tu PC a Internet.
- **Protección de Secretos:** `.env` está en `.gitignore`. Las claves API se enmascaran automáticamente en todas las respuestas de terminal.
- **Supervisión Total:** Puedes pausar el túnel en cualquier momento cerrando el proceso.

---

## 📄 Licencia

Publicado bajo licencia de código abierto **MIT**. Creado con ❤️ por y para la comunidad de desarrolladores de IA.
