# 🔒 Modelo de Seguridad y Buenas Prácticas

La suite **OpenPC-MCP** proporciona acceso potente a tu sistema operativo para maximizar la productividad y autonomía de modelos de inteligencia artificial como ChatGPT. Con un gran poder viene una gran responsabilidad: este documento detalla la arquitectura de seguridad y cómo proteger tu entorno.

---

## 1. Arquitectura de Túnel Saliente (Outbound-Only)

- **Sin puertos abiertos en tu router:** OpenPC-MCP no abre puertos de entrada ni requiere reenvío de puertos (port forwarding), DynDNS ni IP pública.
- **Conexión TLS Saliente:** `tunnel-client` inicia conexiones HTTPS/TLS salientes hacia la infraestructura controlada de OpenAI.
- **Aislamiento detrás de firewall:** Tu servidor MCP local nunca está expuesto a la internet pública.

---

## 2. Niveles de Permisos (UAC en Windows)

1. **Modo Usuario Estándar (`start.bat` normal):**
   - El proceso corre con los privilegios de tu usuario regular.
   - Las operaciones de archivos y comandos están limitadas a lo que tu usuario puede hacer sin elevar permisos.
   - Si un comando intenta modificar archivos del sistema protegidos o controladores, Windows bloqueará la operación.

2. **Modo Administrador Elevado (`install-autostart.bat` o Ejecutar como Administrador):**
   - El proceso hereda el token de Administrador de Windows.
   - Permite instalar software globalmente, reiniciar servicios, gestionar cortafuegos y ejecutar scripts administrativos de PowerShell sin interrupciones de ventanas emergentes UAC.

---

## 3. Protección de Secretos y API Keys

- El archivo `.env` está expresamente excluido de Git a través de `.gitignore`.
- Las herramientas de inspección de entorno (`get_environment_vars`) enmascaran automáticamente claves como `CONTROL_PLANE_API_KEY`, `OPENAI_API_KEY` y tokens de autenticación para que nunca se transmitan en texto plano en la conversación del modelo.

---

## 4. Buenas Prácticas Recomendadas

1. **Usa una carpeta de trabajo (`ChatGPT-Workspace`):** Para proyectos diarios, mantén los repositorios dentro de una carpeta dedicada.
2. **Revisión de comandos destructivos:** Siempre supervisa cuando el modelo realice operaciones en directorios críticos como `C:\Windows` o `C:\Program Files`.
3. **Auditoría de logs:** Puedes consultar en cualquier momento los registros de actividad en `data/tunnel.log` y en la interfaz local de monitorización en `http://127.0.0.1:8080/ui`.
