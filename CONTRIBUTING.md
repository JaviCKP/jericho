# 🤝 Contribuir a OpenPC-MCP

¡Gracias por tu interés en contribuir a OpenPC-MCP! Este proyecto es de código abierto y agradece aportaciones de desarrolladores de todo el mundo.

---

## 🛠️ Cómo añadir nuevas herramientas MCP

1. Selecciona el módulo adecuado en `src/modules/` (o crea un nuevo archivo en `src/modules/` si es una nueva categoría temática).
2. Define el esquema de la herramienta en el array de herramientas:
   ```javascript
   {
     name: 'mi_nueva_herramienta',
     description: 'Descripción clara de qué hace la herramienta y qué devuelve.',
     inputSchema: {
       type: 'object',
       properties: {
         miParametro: { type: 'string', description: 'Descripción del parámetro' }
       },
       required: ['miParametro']
     }
   }
   ```
3. Implementa la función handler correspondiente en el `switch (name)` del módulo.
4. Asegúrate de registrar el nuevo módulo en `src/index.js`.
5. Ejecuta las pruebas unitarias:
   ```bash
   npm test
   ```
6. Actualiza la documentación en `docs/TOOLS_REFERENCE.md`.

---

## 🧪 Ejecutar Tests

Para validar que todas las herramientas y el servidor responden según el protocolo MCP:

```bash
npm test
```

---

## 🚀 Flujo de Pull Requests

1. Haz un Fork del repositorio.
2. Crea una rama para tu feature (`git checkout -b feature/nueva-herramienta`).
3. Realiza tus cambios y verifica que `npm test` pase sin errores.
4. Haz commit de tus cambios (`git commit -m 'feat: añadir herramienta de audio'`).
5. Sube tu rama (`git push origin feature/nueva-herramienta`).
6. Abre un Pull Request describiendo tu propuesta.
