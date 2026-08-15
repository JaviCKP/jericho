const net = require('net');
const TurndownService = require('turndown');
const { formatTextResponse, truncateString } = require('../utils/helpers');
const config = require('../config');

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

// Eliminar scripts y estilos del markdown
turndown.remove(['script', 'style', 'noscript', 'iframe']);

const networkWebTools = [
  {
    name: 'fetch_web_page',
    description: 'Descarga una página web o documentación pública y la convierte automáticamente a Markdown limpio para que puedas leerla y analizarla.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'La URL de la página a consultar (ej. https://es.wikipedia.org, https://docs.github.com).' },
      },
      required: ['url'],
    },
  },
  {
    name: 'check_port',
    description: 'Comprueba si un puerto de red (local o remoto) está abierto y escuchando conexiones (ideal para verificar servidores locales como localhost:3000, 5173, 8080).',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Host o IP a comprobar (por defecto 127.0.0.1 / localhost).' },
        port: { type: 'number', description: 'Número de puerto (ej. 3000, 8080, 5432).' },
        timeoutMs: { type: 'number', description: 'Tiempo límite de comprobación en ms (por defecto 3000).' },
      },
      required: ['port'],
    },
  },
  {
    name: 'http_request',
    description: 'Realiza una petición HTTP/REST personalizada (GET, POST, PUT, DELETE) con cabeceras y cuerpo JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL de la API o endpoint.' },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          description: 'Método HTTP (por defecto GET).',
        },
        headers: { type: 'object', description: 'Cabeceras HTTP opcionales.' },
        body: { type: 'string', description: 'Cuerpo de la petición (texto o JSON string).' },
      },
      required: ['url'],
    },
  },
];

async function handleNetworkWebTool(name, args) {
  switch (name) {
    case 'fetch_web_page': {
      try {
        const response = await fetch(args.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OpenPC-MCP/1.0',
          },
        });

        if (!response.ok) {
          return formatTextResponse(`Error HTTP ${response.status}: ${response.statusText}`, true);
        }

        const html = await response.text();
        const markdown = turndown.turndown(html);

        return formatTextResponse(truncateString(`=== CONTENIDO DE: ${args.url} ===\n\n${markdown}`, config.maxOutputChars));
      } catch (err) {
        return formatTextResponse(`Error obteniendo la página: ${err.message}`, true);
      }
    }

    case 'check_port': {
      const host = args.host || '127.0.0.1';
      const port = args.port;
      const timeout = args.timeoutMs || 3000;

      return new Promise((resolve) => {
        const socket = new net.Socket();
        let status = 'closed';

        socket.setTimeout(timeout);

        socket.on('connect', () => {
          status = 'open';
          socket.destroy();
          resolve(formatTextResponse({ host: host, port: port, status: 'OPEN (En escucha)', isListening: true }));
        });

        socket.on('timeout', () => {
          socket.destroy();
          resolve(formatTextResponse({ host: host, port: port, status: 'TIMEOUT / CLOSED', isListening: false }));
        });

        socket.on('error', (err) => {
          socket.destroy();
          resolve(formatTextResponse({ host: host, port: port, status: 'CLOSED (No disponible)', error: err.code || err.message, isListening: false }));
        });

        socket.connect(port, host);
      });
    }

    case 'http_request': {
      try {
        const method = args.method || 'GET';
        const headers = args.headers || {};
        const options = {
          method: method,
          headers: headers,
        };

        if (args.body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
          options.body = args.body;
          if (!headers['Content-Type'] && args.body.trim().startsWith('{')) {
            headers['Content-Type'] = 'application/json';
          }
        }

        const res = await fetch(args.url, options);
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = text;
        }

        return formatTextResponse({
          status: res.status,
          statusText: res.statusText,
          headers: Object.fromEntries(res.headers.entries()),
          data: data,
        });
      } catch (err) {
        return formatTextResponse(`Error en petición HTTP: ${err.message}`, true);
      }
    }

    default:
      return null;
  }
}

module.exports = {
  networkWebTools,
  handleNetworkWebTool,
};
