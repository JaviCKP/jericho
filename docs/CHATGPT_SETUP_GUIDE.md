# 📱 Guía de Conexión en ChatGPT Web (chatgpt.com)

Esta guía paso a paso te explica cómo conectar la suite **OpenPC-MCP** con tu cuenta de **ChatGPT Web** usando el modo de desarrollador y Secure MCP Tunnel de OpenAI.

---

## 📋 Requisitos Previos
1. Una cuenta en [ChatGPT](https://chatgpt.com) (Plus, Pro, Business, Enterprise o Education con Developer Mode disponible).
2. Acceso a [OpenAI Platform](https://platform.openai.com).
3. Tu PC con Node.js v18 o superior instalado.

---

## 1. Crear el Túnel en OpenAI Platform

1. Inicia sesión en [https://platform.openai.com/settings/organization/tunnels](https://platform.openai.com/settings/organization/tunnels).
2. Haz clic en el botón superior derecho **Create tunnel**.
3. Asigna un nombre al túnel (ej. `Mi-PC-OpenPC`) y pulsa **Create**.
4. Copia el identificador generado (empieza por `tunnel_...`).

---

## 2. Crear la API Key en OpenAI Platform

1. Ve a [https://platform.openai.com/settings/organization/api-keys](https://platform.openai.com/settings/organization/api-keys).
2. Haz clic en **Create new secret key**.
3. Asigna un nombre (ej. `MCP-Runtime-Key`).
4. En permisos, asegúrate de que tenga permisos de **Tunnels (Read + Use)**.
5. Copia la clave secreta generada (`sk-proj-...`).

---

## 3. Configurar e Iniciar OpenPC-MCP en tu PC

En la carpeta del proyecto, ejecuta:

```bash
setup.bat
```
*(o ejecuta `npm run setup` desde la terminal)*.

El asistente te pedirá:
- Tu `Tunnel ID` (del paso 1).
- Tu `API Key` (del paso 2).
- Tu carpeta de trabajo deseada (por defecto `C:\Users\tu_usuario\ChatGPT-Workspace`).

Una vez completado, el asistente validará la conexión y creará el perfil de túnel.

---

## 4. Conectar la App en ChatGPT Web

1. Abre tu navegador y ve a [https://chatgpt.com/#settings/Connectors](https://chatgpt.com/#settings/Connectors) (o haz clic en tu **Foto de Perfil** ➔ **Configuración** ➔ **Conectores / Apps / Developer mode**).
2. Haz clic en **Añadir aplicación / Conectar servidor MCP** (o el botón `+`).
3. En el tipo de conexión, selecciona **Tunnel**.
4. Selecciona tu túnel en la lista o introduce su `Tunnel ID`.
5. ChatGPT se conectará al túnel y cargará automáticamente las **40 herramientas** de tu ordenador.

---

## 5. ¡A trabajar!

Abre un nuevo chat en ChatGPT, asegúrate de activar la aplicación en el selector del chat y pide cualquier tarea:

- *"Toma una captura de pantalla de mi escritorio y dime qué programas tengo abiertos."*
- *"Crea una app web en React dentro de mi carpeta ChatGPT-Workspace, instala las dependencias y arranca el servidor en segundo plano."*
- *"Comprueba el estado de Git en mi proyecto y genera un commit con los cambios."*
- *"Guarda un checkpoint de contexto con lo que hemos hecho hoy para poder continuar mañana."*
