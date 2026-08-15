const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const diff = require('diff');
const { formatTextResponse, truncateString } = require('../utils/helpers');
const config = require('../config');

const filesystemTools = [
  {
    name: 'read_file',
    description: 'Lee el contenido de un archivo. Soporta lectura completa, rango de líneas específico (startLine, endLine) y numeración de líneas para facilitar la edición de código.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta absoluta o relativa del archivo.' },
        startLine: { type: 'number', description: 'Línea de inicio 1-indexada (opcional).' },
        endLine: { type: 'number', description: 'Línea de fin 1-indexada (opcional).' },
        showLineNumbers: { type: 'boolean', description: 'Si es true, numera cada línea como 1: ..., 2: ...' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Crea o sobrescribe un archivo en cualquier ruta de tu disco, creando automáticamente las carpetas intermedias necesarias.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta del archivo a guardar.' },
        content: { type: 'string', description: 'Contenido completo en texto.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file_replace',
    description: 'Realiza una edición quirúrgica en un archivo reemplazando un bloque exacto de texto antiguo por el nuevo texto sin tener que reescribir todo el archivo.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta del archivo a editar.' },
        targetText: { type: 'string', description: 'El texto o bloque exacto que se desea reemplazar.' },
        replacementText: { type: 'string', description: 'El nuevo texto que sustituirá a targetText.' },
      },
      required: ['path', 'targetText', 'replacementText'],
    },
  },
  {
    name: 'search_files',
    description: 'Busca archivos en el sistema que coincidan con un patrón glob (ej. **/*.js, src/**/*.tsx, *.json) o por coincidencia de nombre.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directorio base de búsqueda (por defecto el directorio de trabajo).' },
        pattern: { type: 'string', description: 'Patrón glob a buscar (ej. **/*.py, **/*.md).' },
        maxResults: { type: 'number', description: 'Límite de resultados (por defecto 100).' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep_in_files',
    description: 'Busca texto o expresiones regulares dentro del contenido de múltiples archivos de un proyecto, devolviendo número de línea y coincidencia (excluyendo automáticamente node_modules y .git).',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directorio donde buscar.' },
        query: { type: 'string', description: 'Texto o patrón a buscar dentro del código.' },
        isRegex: { type: 'boolean', description: 'Si es true, interpreta query como expresión regular.' },
        filePattern: { type: 'string', description: 'Filtro opcional de extensiones (ej. *.js o *.py).' },
        maxMatches: { type: 'number', description: 'Número máximo de coincidencias (por defecto 100).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_directory_tree',
    description: 'Genera un árbol visual (ASCII) de carpetas y archivos con límite de profundidad configurable para entender la arquitectura de un proyecto.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Carpeta a explorar (por defecto el directorio de trabajo).' },
        maxDepth: { type: 'number', description: 'Profundidad máxima del árbol (por defecto 3 niveles).' },
      },
    },
  },
  {
    name: 'file_operations',
    description: 'Permite realizar operaciones de gestión de archivos: copy, move, rename, delete (archivo o carpeta recursiva).',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['copy', 'move', 'rename', 'delete'],
          description: 'Tipo de operación a realizar.',
        },
        sourcePath: { type: 'string', description: 'Ruta del archivo o carpeta origen.' },
        destinationPath: { type: 'string', description: 'Ruta destino (requerida para copy, move y rename).' },
      },
      required: ['operation', 'sourcePath'],
    },
  },
];

function generateTree(dirPath, maxDepth, currentDepth = 0, prefix = '') {
  if (currentDepth > maxDepth) return '';
  let result = '';

  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    const filtered = items.filter((it) => it.name !== 'node_modules' && it.name !== '.git' && it.name !== '.next');

    filtered.forEach((item, index) => {
      const isLast = index === filtered.length - 1;
      const pointer = isLast ? '└── ' : '├── ';
      const line = `${prefix}${pointer}${item.name}${item.isDirectory() ? '/' : ''}\n`;
      result += line;

      if (item.isDirectory() && currentDepth < maxDepth) {
        const nextPrefix = prefix + (isLast ? '    ' : '│   ');
        result += generateTree(path.join(dirPath, item.name), maxDepth, currentDepth + 1, nextPrefix);
      }
    });
  } catch (e) {
    result += `${prefix} [Error leyendo directorio: ${e.message}]\n`;
  }
  return result;
}

async function handleFilesystemTool(name, args) {
  switch (name) {
    case 'read_file': {
      const targetPath = path.resolve(args.path);
      if (!fs.existsSync(targetPath)) {
        return formatTextResponse(`Error: El archivo no existe en la ruta '${targetPath}'`, true);
      }

      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        return formatTextResponse(`Error: '${targetPath}' es un directorio, no un archivo. Usa get_directory_tree o search_files.`, true);
      }

      const content = fs.readFileSync(targetPath, 'utf-8');
      const lines = content.split(/\r?\n/);
      const totalLines = lines.length;

      let start = (args.startLine ? Math.max(1, args.startLine) : 1) - 1;
      let end = args.endLine ? Math.min(totalLines, args.endLine) : totalLines;

      const slice = lines.slice(start, end);
      let outputText = '';

      if (args.showLineNumbers) {
        outputText = slice.map((l, idx) => `${start + idx + 1}: ${l}`).join('\n');
      } else {
        outputText = slice.join('\n');
      }

      const header = `[Archivo: ${targetPath} | Mostrando líneas ${start + 1} a ${end} de ${totalLines} total]\n\n`;
      return formatTextResponse(truncateString(header + outputText, config.maxOutputChars));
    }

    case 'write_file': {
      const targetPath = path.resolve(args.path);
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(targetPath, args.content, 'utf-8');
      const stat = fs.statSync(targetPath);
      return formatTextResponse(`Archivo guardado con éxito en: ${targetPath} (${stat.size} bytes escritos).`);
    }

    case 'edit_file_replace': {
      const targetPath = path.resolve(args.path);
      if (!fs.existsSync(targetPath)) {
        return formatTextResponse(`Error: El archivo '${targetPath}' no existe.`, true);
      }

      const original = fs.readFileSync(targetPath, 'utf-8');
      if (!original.includes(args.targetText)) {
        return formatTextResponse(`Error: No se encontró el texto buscado dentro del archivo '${targetPath}'. Asegúrate de que los espacios y líneas coinciden exactamente.`, true);
      }

      // Reemplazar la primera ocurrencia de forma precisa
      const modified = original.replace(args.targetText, args.replacementText);
      fs.writeFileSync(targetPath, modified, 'utf-8');

      return formatTextResponse(`Edición completada con éxito en '${targetPath}'. Se ha reemplazado el bloque especificado.`);
    }

    case 'search_files': {
      const baseDir = args.directory ? path.resolve(args.directory) : config.workspaceDir;
      const pattern = args.pattern || '**/*';
      const maxResults = args.maxResults || 100;

      try {
        const matches = await glob(pattern, {
          cwd: baseDir,
          nodir: false,
          ignore: ['**/node_modules/**', '**/.git/**', '**/.next/**'],
          maxDepth: 10,
        });

        const limited = matches.slice(0, maxResults);
        return formatTextResponse({
          baseDirectory: baseDir,
          pattern: pattern,
          totalMatchesFound: matches.length,
          returnedMatches: limited.length,
          files: limited,
        });
      } catch (err) {
        return formatTextResponse(`Error en búsqueda de archivos: ${err.message}`, true);
      }
    }

    case 'grep_in_files': {
      const baseDir = args.directory ? path.resolve(args.directory) : config.workspaceDir;
      const filePattern = args.filePattern || '**/*.*';
      const query = args.query;
      const isRegex = args.isRegex || false;
      const maxMatches = args.maxMatches || 100;

      let regex;
      try {
        regex = isRegex ? new RegExp(query, 'i') : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      } catch (e) {
        return formatTextResponse(`Error en la expresión regular: ${e.message}`, true);
      }

      try {
        const files = await glob(filePattern, {
          cwd: baseDir,
          nodir: true,
          ignore: ['**/node_modules/**', '**/.git/**', '**/.next/**', '**/*.exe', '**/*.png', '**/*.jpg', '**/*.zip'],
        });

        const results = [];
        for (const relFile of files) {
          if (results.length >= maxMatches) break;
          const fullPath = path.join(baseDir, relFile);
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split(/\r?\n/);
            lines.forEach((line, idx) => {
              if (results.length < maxMatches && regex.test(line)) {
                results.push({
                  file: relFile,
                  lineNumber: idx + 1,
                  lineContent: line.trim(),
                });
              }
            });
          } catch (e) {
            // Archivo binario o no legible, omitir
          }
        }

        return formatTextResponse({
          baseDirectory: baseDir,
          query: query,
          totalMatches: results.length,
          matches: results,
        });
      } catch (err) {
        return formatTextResponse(`Error ejecutando grep: ${err.message}`, true);
      }
    }

    case 'get_directory_tree': {
      const targetDir = args.directory ? path.resolve(args.directory) : config.workspaceDir;
      const depth = args.maxDepth !== undefined ? args.maxDepth : 3;

      if (!fs.existsSync(targetDir)) {
        return formatTextResponse(`Error: El directorio '${targetDir}' no existe.`, true);
      }

      const tree = `${targetDir}/\n` + generateTree(targetDir, depth);
      return formatTextResponse(truncateString(tree, config.maxOutputChars));
    }

    case 'file_operations': {
      const src = path.resolve(args.sourcePath);
      const op = args.operation;

      if (!fs.existsSync(src)) {
        return formatTextResponse(`Error: La ruta de origen '${src}' no existe.`, true);
      }

      try {
        switch (op) {
          case 'delete': {
            const stat = fs.statSync(src);
            if (stat.isDirectory()) {
              fs.rmSync(src, { recursive: true, force: true });
            } else {
              fs.unlinkSync(src);
            }
            return formatTextResponse(`'${src}' eliminado con éxito.`);
          }

          case 'copy': {
            if (!args.destinationPath) return formatTextResponse('destinationPath es obligatorio para copy', true);
            const dst = path.resolve(args.destinationPath);
            const dstDir = path.dirname(dst);
            if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
            fs.cpSync(src, dst, { recursive: true });
            return formatTextResponse(`Copiado con éxito de '${src}' a '${dst}'.`);
          }

          case 'move':
          case 'rename': {
            if (!args.destinationPath) return formatTextResponse('destinationPath es obligatorio para move/rename', true);
            const dst = path.resolve(args.destinationPath);
            const dstDir = path.dirname(dst);
            if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
            fs.renameSync(src, dst);
            return formatTextResponse(`Movido/renombrado con éxito a '${dst}'.`);
          }

          default:
            return formatTextResponse(`Operación '${op}' no reconocida.`, true);
        }
      } catch (err) {
        return formatTextResponse(`Error en operación de archivo: ${err.message}`, true);
      }
    }

    default:
      return null;
  }
}

module.exports = {
  filesystemTools,
  handleFilesystemTool,
};
