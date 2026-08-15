# 🖥️ OpenPC-MCP: Conecta ChatGPT a tu PC con Control Total y Visión

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![Model Context Protocol](https://img.shields.io/badge/Protocol-MCP-orange.svg)](https://modelcontextprotocol.io/)
[![ChatGPT Compatible](https://img.shields.io/badge/ChatGPT-Web%20%26%20Developer%20Mode-blueviolet.svg)](https://chatgpt.com)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

> **OpenPC-MCP** es una suite profesional de código abierto construida sobre el protocolo **Model Context Protocol (MCP)** de OpenAI y Anthropic. Permite que **ChatGPT Web ([chatgpt.com](https://chatgpt.com))** interactúe directamente con tu ordenador a través de **OpenAI Secure MCP Tunnel**, con capacidades de **visión de pantalla, control de ratón y teclado, terminal avanzada, edición de código, checkpoints de contexto y memoria persistente**.

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
                                    ▼  Conexión Saliente (Sin abrir puertos)
┌────────────────────────────────────────────────────────────────────────┐
│                     tunnel-client (Daemon Local)                       │
│                Panel Web Local: http://127.0.0.1:8080/ui               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼  stdio (JSON-RPC 2.0)
┌────────────────────────────────────────────────────────────────────────┐
│                     OpenPC-MCP Suite (src/index.js)                    │
├────────────────────────────────────────────────────────────────────────┤
│  👁️ Visión & GUI       ⚡ Terminal & Shell     📁 Sistema de Archivos  │
│  🧠 Checkpoints Memoria 🐙 Git & Dev Tools      📊 Monitor de Sistema    │
│  🌐 Web & Red           🛡️ Elevación UAC / Admin                        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Tu Ordenador (Windows / macOS / Linux)               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Características Principales (40 Herramientas Integradas)

| Módulo | Capacidades |
| :--- | :--- |
| 👁️ **Computer Use & Visión** | Capturas de pantalla en tiempo real enviadas como **imagen nativa**, cuadrícula de coordenadas opcional, clics exactos de ratón, arrastrar y soltar, scroll, escritura de texto, atajos de teclado (`ctrl+c`, `alt+tab`, etc.) y gestión de ventanas activas. |
| ⚡ **Terminal & Shell** | Ejecución en PowerShell, CMD o Bash con captura de logs y tiempos. Soporte para **servidores en segundo plano** (`run_background_command`), lectura de logs en streaming y finalización de procesos. |
| 📁 **Ingeniería de Archivos** | Lectura con rango de líneas y numeración, escritura atómica, **edición quirúrgica sin reescribir todo el archivo** (`edit_file_replace`), búsqueda glob, grep recursivo con exclusión de `node_modules` y árbol visual de carpetas. |
| 🧠 **Context Checkpoints & Memoria** | **Guarda el estado completo de tus proyectos** (`save_context_checkpoint`) y recupéralo en chats futuros (`load_context_checkpoint`) para nunca perder el hilo de desarrollo. Almacén de memoria a largo plazo para preferencias y reglas. |
| 🐙 **Git & Control de Versiones** | Estado de ramas, diffs unificados, lectura de commits, commits automáticos estructurados y cambio de ramas. |
| 📊 **Rendimiento & Sistema** | Información de CPU, RAM, espacio libre en discos, listado de procesos con memoria, cierre de procesos colgados y apertura de programas o URLs. |
| 🌐 **Red & Web Scraping** | Descarga de páginas web o documentación y **conversión automática a Markdown limpio**, comprobación de puertos en escucha (`localhost:3000`, `8080`) y cliente HTTP REST. |

---

## 🚀 Inicio Rápido (En 3 Pasos)

### 1. Clonar el repositorio e instalar dependencias

```bash
git clone https://github.com/tu-usuario/chatgpt-pc-mcp.git
cd chatgpt-pc-mcp
npm install
```

### 2. Ejecutar el Asistente de Configuración

En Windows, simplemente haz doble clic en **`setup.bat`** (o ejecuta en terminal `npm run setup`).

El asistente te guiará para introducir:
1. Tu **Tunnel ID** (obtenido en [OpenAI Platform - Tunnels](https://platform.openai.com/settings/organization/tunnels)).
2. Tu **Control Plane API Key** (obtenida en [OpenAI Platform - API Keys](https://platform.openai.com/settings/organization/api-keys) con permisos `Tunnels: Read + Use`).

### 3. Conectar en ChatGPT Web

1. Abre tu navegador en [https://chatgpt.com/#settings/Connectors](https://chatgpt.com/#settings/Connectors).
2. Haz clic en **Añadir aplicación / Conectar servidor MCP**.
3. Selecciona **Tunnel** e introduce o selecciona tu `Tunnel ID`.
4. ¡Listo! Abre un nuevo chat, activa tu app y ChatGPT tendrá control total sobre las 40 herramientas de tu ordenador.

---

## 🖥️ Modos de Ejecución

### Modo 1: Consola Visible (Primer Plano)
Ideal para desarrollo y monitorización en directo.
- Haz doble clic en **`start.bat`** (o `npm start`).
- Mantén la consola abierta mientras utilices ChatGPT.
- Panel de control web local disponible en: [http://127.0.0.1:8080/ui](http://127.0.0.1:8080/ui).

### Modo 2: 100% Invisible (Segundo Plano)
- Haz doble clic en **`scripts/start-silent.vbs`**.
- Arranca el túnel de forma completamente transparente, sin ventanas de consola ni pestañas.

### Modo 3: Inicio Automático con Windows (Como Administrador)
- Haz doble clic en **`install-autostart.bat`**.
- Registra una tarea programada en Windows con `RunLevel Highest` (permisos de Administrador sin ventanas UAC).
- Cada vez que enciendas el PC, el túnel estará disponible inmediatamente.
- *(Para desinstalarlo en el futuro: ejecuta `scripts/uninstall-autostart.bat`)*.

---

## 💬 Ejemplos de Prompts para ChatGPT

### 🛠️ Programación y Desarrollo Web
> *"Dentro de mi carpeta de trabajo `ChatGPT-Workspace`, crea un proyecto nuevo con Vite y React, añade una página con TailwindCSS, instala las dependencias y arranca el servidor de desarrollo en segundo plano con `run_background_command`. Comprueba si el puerto 5173 está en escucha."*

### 👁️ Control de Escritorio y Visión
> *"Toma una captura de pantalla de mi monitor con `take_screenshot` (con cuadrícula de coordenadas activada), dime qué aplicación tengo en primer plano y haz clic en el botón de guardar."*

### 🧠 Checkpoint de Contexto
> *"Hemos terminado la funcionalidad de inicio de sesión y la base de datos SQLite. Guarda un checkpoint de contexto llamado 'Auth y DB completados' con el resumen de los cambios, los archivos tocados y los 3 siguientes pasos pendientes."*

### 🔄 Reanudar Proyecto en un Chat Nuevo
> *"Carga el último checkpoint de contexto guardado del proyecto y dime en qué punto nos quedamos y qué tareas tenemos pendientes para hoy."*

---

## 📁 Estructura del Proyecto

```text
chatgpt-pc-mcp/
├── bin/                       # Binarios oficiales de OpenAI (tunnel-client, cloudflared)
├── src/
│   ├── index.js               # Servidor MCP central y enrutador de herramientas
│   ├── config.js              # Carga de variables de entorno y directorios
│   ├── modules/
│   │   ├── vision_gui.js      # Capturas, cuadrícula de coordenadas, ratón y teclado
│   │   ├── terminal.js        # PowerShell, background tasks y streaming de logs
│   │   ├── filesystem.js      # Lectura/escritura, edición por bloques y grep
│   │   ├── context_checkpoints.js # Snapshots de proyectos y memoria persistente
│   │   ├── git_dev.js         # Operaciones Git completas
│   │   ├── system_process.js  # Rendimiento, CPU/RAM/Discos y procesos
│   │   └── network_web.js     # Web scraping a Markdown, puertos y HTTP REST
│   └── utils/
│       ├── logger.js          # Sistema de logs con niveles y volcado a archivo
│       ├── platform.js        # Detección de OS y elevación de Administrador
│       └── helpers.js         # Formateadores de respuesta MCP
├── scripts/
│   ├── setup.js / setup.bat   # Asistente de configuración interactivo
│   ├── start.bat              # Lanzador en primer plano
│   ├── start-silent.vbs       # Lanzador 100% invisible
│   ├── install-autostart.bat  # Instalador de servicio en Windows Scheduler
│   ├── uninstall-autostart.bat# Desinstalador de la tarea
│   ├── doctor.js              # Diagnóstico integral del sistema
│   └── download-binaries.js   # Descargador automático de binarios oficiales
├── docs/
│   ├── TOOLS_REFERENCE.md     # Catálogo detallado de las 40 herramientas
│   ├── CHATGPT_SETUP_GUIDE.md # Guía paso a paso para chatgpt.com
│   └── SECURITY.md            # Modelo de seguridad y buenas prácticas
├── data/                      # Almacén local de checkpoints y memoria persistente
├── .env.example               # Plantilla de configuración
├── package.json               # Dependencias y scripts
├── README.md                  # Documentación principal
└── LICENSE                    # Licencia MIT
```

---

## 🔒 Seguridad y Privacidad

- **Sin puertos abiertos al exterior:** La conexión se establece exclusivamente de forma saliente mediante túnel HTTPS/TLS seguro con los servidores de OpenAI.
- **Protección de credenciales:** Las claves de API y tokens de autenticación se enmascaran automáticamente y nunca son visibles para el modelo.
- **Tú tienes el control:** Puedes detener el servidor en cualquier momento cerrando la ventana o matando el proceso.

Consulta [`docs/SECURITY.md`](docs/SECURITY.md) para más detalles.

---

## 📄 Licencia

Este proyecto está bajo la licencia **MIT**. Consulta el archivo [`LICENSE`](LICENSE) para más detalles.
