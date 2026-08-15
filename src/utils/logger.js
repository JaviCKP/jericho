const fs = require('fs');
const path = require('path');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

let currentLogLevel = LOG_LEVELS.INFO;
let logFilePath = null;

function setLogLevel(level) {
  if (LOG_LEVELS[level.toUpperCase()] !== undefined) {
    currentLogLevel = LOG_LEVELS[level.toUpperCase()];
  }
}

function initFileLogging(filePath) {
  logFilePath = path.resolve(filePath);
  const dir = path.dirname(logFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function formatLogMessage(level, message, meta) {
  const timestamp = new Date().toISOString();
  let metaStr = '';
  if (meta && Object.keys(meta).length > 0) {
    metaStr = ' ' + JSON.stringify(meta);
  }
  return `[${timestamp}] [${level}] ${message}${metaStr}`;
}

function writeToFile(formattedMsg) {
  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, formattedMsg + '\n', 'utf-8');
    } catch (e) {
      // Ignore file logging errors to prevent crash
    }
  }
}

const logger = {
  debug(message, meta = {}) {
    if (currentLogLevel <= LOG_LEVELS.DEBUG) {
      const msg = formatLogMessage('DEBUG', message, meta);
      console.error('\x1b[90m' + msg + '\x1b[0m'); // Gray in stderr
      writeToFile(msg);
    }
  },

  info(message, meta = {}) {
    if (currentLogLevel <= LOG_LEVELS.INFO) {
      const msg = formatLogMessage('INFO', message, meta);
      console.error('\x1b[36m' + msg + '\x1b[0m'); // Cyan in stderr
      writeToFile(msg);
    }
  },

  warn(message, meta = {}) {
    if (currentLogLevel <= LOG_LEVELS.WARN) {
      const msg = formatLogMessage('WARN', message, meta);
      console.error('\x1b[33m' + msg + '\x1b[0m'); // Yellow in stderr
      writeToFile(msg);
    }
  },

  error(message, meta = {}) {
    if (currentLogLevel <= LOG_LEVELS.ERROR) {
      const msg = formatLogMessage('ERROR', message, meta);
      console.error('\x1b[31m' + msg + '\x1b[0m'); // Red in stderr
      writeToFile(msg);
    }
  },

  setLogLevel,
  initFileLogging,
};

module.exports = logger;
