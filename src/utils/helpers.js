function formatTextResponse(text, isError = false) {
  return {
    content: [
      {
        type: 'text',
        text: typeof text === 'string' ? text : JSON.stringify(text, null, 2),
      },
    ],
    isError: isError,
  };
}

function formatImageResponse(base64Data, description = '', mimeType = 'image/png') {
  const content = [];
  if (description) {
    content.push({
      type: 'text',
      text: description,
    });
  }
  content.push({
    type: 'image',
    data: base64Data,
    mimeType: mimeType,
  });
  return {
    content: content,
    isError: false,
  };
}

function truncateString(str, maxLength = 20000) {
  if (!str || str.length <= maxLength) return str;
  const remaining = str.length - maxLength;
  return str.substring(0, maxLength) + `\n\n... [TRUNCADO: ${remaining} caracteres adicionales omitidos]`;
}

function sanitizePath(inputPath, defaultBase = process.cwd()) {
  const path = require('path');
  if (!inputPath) return defaultBase;
  return path.resolve(defaultBase, inputPath);
}

module.exports = {
  formatTextResponse,
  formatImageResponse,
  truncateString,
  sanitizePath,
};
