# 🛠️ OpenPC-MCP: Referencia Completa de Herramientas (40 Herramientas)

Este documento detalla todas las herramientas expuestas por la suite **OpenPC-MCP** a través del protocolo Model Context Protocol (MCP) para ChatGPT Web y otros clientes MCP compatibles.

---

## 📑 Índice de Módulos

1. [Visión & Control de Escritorio (Computer Use)](#1-visión--control-de-escritorio)
2. [Terminal & Shell Avanzada](#2-terminal--shell-avanzada)
3. [Sistema de Archivos e Ingeniería de Código](#3-sistema-de-archivos)
4. [Checkpoints de Contexto & Memoria Persistente](#4-checkpoints-de-contexto--memoria)
5. [Git & Control de Versiones](#5-git--control-de-versiones)
6. [Gestión de Procesos y Rendimiento](#6-gestión-de-procesos-y-rendimiento)
7. [Red & Peticiones Web](#7-red--peticiones-web)

---

## 1. Visión & Control de Escritorio

### `take_screenshot`
Captura la pantalla completa en tiempo real y la devuelve como imagen PNG nativa para que la visión de ChatGPT la analice.
- **Parámetros:**
  - `withCoordinateGrid` *(boolean, opcional)*: Superpone una cuadrícula de coordenadas cada 200px para facilitar el cálculo de clics.
  - `savePath` *(string, opcional)*: Ruta local donde guardar una copia del archivo PNG.
- **Ejemplo de Prompt:**
  > *"Toma una captura de pantalla con cuadrícula de coordenadas y dime qué botones ves en la ventana activa."*

### `mouse_click`
Mueve el cursor y hace clic en cualquier coordenada de la pantalla.
- **Parámetros:**
  - `x` *(number, requerido)*: Coordenada horizontal.
  - `y` *(number, requerido)*: Coordenada vertical.
  - `button` *(enum: `left`, `right`, `middle`)*: Botón a pulsar (por defecto `left`).
  - `clicks` *(number)*: 1 para clic simple, 2 para doble clic, 3 para triple clic.

### `mouse_move` & `mouse_drag`
Mueve el cursor suavemente o arrastra elementos (Drag & Drop) de `(startX, startY)` a `(endX, endY)`.

### `mouse_scroll`
Desplaza la rueda del ratón. Valores positivos para bajar (ej. `5`), valores negativos para subir (ej. `-5`).

### `type_text`
Escribe texto simulando pulsaciones reales de teclado en el cuadro o elemento actualmente enfocado.
- **Parámetros:**
  - `text` *(string, requerido)*: Texto a escribir.

### `press_hotkey`
Ejecuta combinaciones de teclas simultáneas.
- **Parámetros:**
  - `keys` *(array de strings, requerido)*: Ejemplos: `["ctrl", "c"]`, `["alt", "tab"]`, `["win", "r"]`, `["enter"]`.

### `get_screen_metrics`
Devuelve la resolución de la pantalla en píxeles (ancho y alto).

### `list_windows` & `focus_window`
- `list_windows`: Lista todas las ventanas abiertas en el escritorio con título, ID y nombre del proceso.
- `focus_window`: Trae al frente la ventana que coincida con el título o proceso indicado.

---

## 2. Terminal & Shell Avanzada

### `run_command`
Ejecuta cualquier comando en PowerShell (Windows) o Bash (Unix) con captura de stdout, stderr, código de salida y tiempo de ejecución.
- **Parámetros:**
  - `command` *(string, requerido)*: Comando a ejecutar.
  - `cwd` *(string, opcional)*: Directorio de trabajo.
  - `timeoutMs` *(number, opcional)*: Tiempo límite (por defecto 60000 ms).
  - `shell` *(enum: `powershell`, `cmd`, `bash`, `default`)*.

### `run_background_command`
Inicia un proceso o servidor de larga duración en segundo plano sin bloquear la conversación. Devuelve un `taskId`.
- **Parámetros:**
  - `command` *(string, requerido)*: Ej. `npm run dev`, `python -m http.server 8000`.

### `get_background_task_output` & `kill_background_task`
- `get_background_task_output`: Lee el buffer de salida acumulado por una tarea en segundo plano.
- `kill_background_task`: Finaliza la tarea en segundo plano.
- `list_background_tasks`: Muestra todas las tareas activas y finalizadas.

### `get_environment_vars`
Inspecciona variables de entorno del sistema con filtro opcional de búsqueda (protegiendo automáticamente secretos).

---

## 3. Sistema de Archivos

### `read_file`
Lee archivos con soporte para rango de líneas (`startLine`, `endLine`) y visualización de números de línea (`showLineNumbers`).

### `write_file`
Crea o sobrescribe archivos creando automáticamente los directorios necesarios.

### `edit_file_replace`
Reemplaza quirúrgicamente un bloque específico de código dentro de un archivo sin reescribir el resto del documento.

### `search_files`
Busca archivos en el proyecto mediante patrones glob (ej. `src/**/*.tsx`, `**/*.py`).

### `grep_in_files`
Busca texto o expresiones regulares dentro del código fuente de múltiples archivos, ignorando automáticamente `node_modules` y `.git`.

### `get_directory_tree`
Genera un árbol visual en ASCII de carpetas y archivos con límite de profundidad configurable.

### `file_operations`
Operaciones de archivos: `copy`, `move`, `rename`, `delete`.

---

## 4. Checkpoints de Contexto & Memoria

### `save_context_checkpoint`
Guarda una instantánea completa del estado de trabajo:
- `title`: Título del checkpoint.
- `project`: Nombre del proyecto.
- `summary`: Resumen de lo realizado.
- `modifiedFiles`: Archivos modificados.
- `nextSteps`: Próximos pasos a seguir.
- `metadata`: Variables, puertos o notas técnicas.

### `load_context_checkpoint`
Recupera el último checkpoint guardado o uno específico para que cualquier chat nuevo de ChatGPT retome el proyecto exactamente donde lo dejaste.

### `list_context_checkpoints`
Muestra el historial cronológico de checkpoints guardados.

### `store_memory` & `recall_memory`
- `store_memory`: Guarda reglas persistentes, preferencias del usuario o decisiones técnicas en el almacenamiento local.
- `recall_memory`: Recupera memorias por palabra clave o etiqueta.

---

## 5. Git & Control de Versiones

- `git_status`: Estado detallado de ramas, cambios y archivos modificados.
- `git_diff`: Muestra el diff unificado de cambios staged o unstaged.
- `git_log`: Historial reciente de commits.
- `git_commit`: Añade archivos y genera un commit con mensaje descriptivo.
- `git_branch`: Lista, crea o cambia de rama.

---

## 6. Gestión de Procesos y Rendimiento

- `get_system_health`: Estadísticas de CPU, memoria RAM disponible/usada, espacio en discos y estado de elevación de Administrador.
- `list_processes`: Procesos ordenados por consumo de memoria con PID.
- `kill_process`: Finaliza procesos por PID o nombre de ejecutable.
- `open_app_or_url`: Abre aplicaciones de escritorio, archivos o enlaces web en el navegador.

---

## 7. Red & Peticiones Web

- `fetch_web_page`: Descarga cualquier página web o documentación y la convierte a Markdown limpio.
- `check_port`: Comprueba si un puerto local o remoto (ej. `localhost:3000`, `8080`) está en escucha.
- `http_request`: Realiza peticiones HTTP REST completas (GET, POST, PUT, DELETE, PATCH con headers y body JSON).
