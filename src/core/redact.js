'use strict';

/**
 * Capa de redacción común.
 *
 * Se aplica a TODO lo que sale hacia el modelo, hacia los logs y hacia el diario:
 * stdout, stderr, logs, diffs, resultados de Git, URLs, cabeceras, errores y
 * argumentos de procesos.
 *
 * Dos estrategias combinadas:
 *  1. Valores exactos conocidos (los del entorno del servidor) -> reemplazo literal.
 *     Es la única que garantiza que un secreto real no salga.
 *  2. Patrones genéricos (tokens tipo sk-..., ghp_..., JWT, claves privadas, etc.).
 *     Es defensa en profundidad para secretos que el servidor no conoce.
 */

// No hay longitud mínima: incluso un secreto de un carácter debe quedar
// cubierto. Para esos valores la sustitución es deliberadamente global; es la
// única garantía demostrable de no fuga (y el llamador debe evitar registrar
// secretos de un carácter salvo cuando sea imprescindible).
const MIN_SECRET_LEN = 1;

/** Nombres de variables de entorno que se consideran secretas. */
const SENSITIVE_NAME_RE =
  /(KEY|SECRET|TOKEN|PASS|PASSWD|PASSWORD|AUTH|CREDENTIAL|COOKIE|SALT|SESSION|PRIVATE|SIGNATURE|CLIENT_ID|CONNECTION_STRING|DSN)/i;

/**
 * Claves cuyo VALOR es el NOMBRE de un secreto, no el secreto.
 *
 * Sin esta excepción, el diario registraría `secret_name: "[REDACTED]"`, que es
 * inútil: el requisito es saber QUÉ secreto se usó sin guardar su valor.
 */
const NAME_ONLY_KEYS = new Set([
  'secret_name',
  'secret_names',
  'secrets_injected',
  'secrets_available',
  'session_id',
  'key_name',
  'token_name',
  'allowed_secrets',
]);

/** Patrones de secretos reconocibles por forma. */
const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED:private-key]'],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED:openai-key]'],
  [/\bsk-proj-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED:openai-key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED:github-token]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED:slack-token]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED:aws-access-key-id]'],
  [/\bASIA[0-9A-Z]{16}\b/g, '[REDACTED:aws-temp-key-id]'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[REDACTED:google-api-key]'],
  [/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED:jwt]'],
  [/\btunnel_[0-9a-f]{16,}\b/gi, '[REDACTED:tunnel-id]'],
  // Asignaciones en texto: FOO_TOKEN=valor  /  "api_key": "valor"
  [/\b([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*)\s*[=:]\s*(["']?)([^\s"',;]{6,})\2/gi,
    (_m, name, q) => `${name}=${q}[REDACTED:by-name]${q}`],
  // Credenciales embebidas en URL
  [/\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, (_m, scheme, user) => `${scheme}${user}:[REDACTED:url-credential]@`],
  // Cabeceras Authorization / Cookie en texto plano
  [/\b(Authorization|Proxy-Authorization|Cookie|Set-Cookie|X-Api-Key|X-Auth-Token)\s*:\s*[^\r\n]+/gi,
    (_m, h) => `${h}: [REDACTED:header]`],
];

/** Valores literales que hay que borrar siempre (se rellena en `init`). */
let literalSecrets = [];
let secretVariants = [];

function variantsFor(secret) {
  const variants = new Set([secret]);
  try {
    variants.add(encodeURIComponent(secret));
    variants.add(JSON.stringify(secret));
    variants.add(JSON.stringify(secret).slice(1, -1));
    variants.add(Buffer.from(secret, 'utf8').toString('base64'));
  } catch (_) { /* valores de texto normales; ignorar codificaciones imposibles */ }
  return [...variants].filter((v) => typeof v === 'string' && v.length > 0);
}

function rebuildVariants() {
  const rows = [];
  for (const secret of literalSecrets) {
    for (const variant of variantsFor(secret)) rows.push({ variant, secret });
  }
  secretVariants = rows.sort((a, b) => b.variant.length - a.variant.length);
}

/**
 * Registra los valores exactos a redactar. Se llama al arrancar con el entorno
 * del servidor, de modo que ningún secreto real del host pueda salir por ningún canal.
 */
function init(env = process.env, extraValues = []) {
  const values = new Set();
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue;
    if (value.length < MIN_SECRET_LEN) continue;
    if (!SENSITIVE_NAME_RE.test(name)) continue;
    values.add(value);
  }
  for (const v of extraValues) {
    if (typeof v === 'string' && v.length >= MIN_SECRET_LEN) values.add(v);
  }
  // Los más largos primero: evita que un prefijo corto rompa el reemplazo de uno largo.
  literalSecrets = [...values].sort((a, b) => b.length - a.length);
  rebuildVariants();
  return literalSecrets.length;
}

function registerSecretValue(value) {
  if (typeof value !== 'string' || value.length < MIN_SECRET_LEN) return false;
  if (literalSecrets.includes(value)) return false;
  literalSecrets.push(value);
  literalSecrets.sort((a, b) => b.length - a.length);
  rebuildVariants();
  return true;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Redacta una cadena. Es idempotente. */
function redactText(input) {
  if (typeof input !== 'string' || input.length === 0) return input;
  let out = input;
  // Una sola pasada evita que los marcadores se vuelvan a modificar cuando
  // otro secreto corto coincide con una letra de "[REDACTED...]".
  if (secretVariants.length > 0) {
    const byVariant = new Map(secretVariants.map(({ variant }) => [variant, true]));
    const re = new RegExp(secretVariants.map(({ variant }) => escapeRe(variant)).join('|'), 'g');
    out = out.replace(re, (match) => {
      const b64 = Buffer.from(match, 'utf8').toString('base64');
      return byVariant.has(b64) && b64 !== match
        ? '[REDACTED:env-secret-encoded]'
        : '[REDACTED:env-secret]';
    });
  }
  for (const [re, repl] of PATTERNS) {
    out = out.replace(re, repl);
  }
  return out;
}

/** Redacta recursivamente cualquier valor JSON-serializable. */
function redactValue(value, depth = 0) {
  if (depth > 12) return '[REDACTED:depth-limit]';
  if (value == null) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Buffer.isBuffer(value)) return `[binary ${value.length} bytes]`;
  if (value instanceof Error) {
    return {
      name: redactText(value.name),
      message: redactText(value.message),
      ...(value.stack ? { stack: redactText(value.stack) } : {}),
      ...(value.code ? { code: value.code } : {}),
    };
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (NAME_ONLY_KEYS.has(k)) {
        // Aun siendo un nombre, se pasa por la redacción de texto por si
        // alguien metiese ahí un valor por error.
        out[k] = redactValue(v, depth + 1);
      } else if (SENSITIVE_NAME_RE.test(k) && typeof v === 'string' && v.length >= 4) {
        out[k] = '[REDACTED:by-key]';
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

/** Redacta cabeceras HTTP conservando los nombres. */
function redactHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_NAME_RE.test(k) ? '[REDACTED:header]' : redactText(String(v));
  }
  return out;
}

/** Redacta una URL: conserva origen y ruta, elimina credenciales y valores de query. */
function redactUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.username || u.password) {
      u.username = u.username ? '[REDACTED]' : '';
      u.password = '';
    }
    for (const key of [...u.searchParams.keys()]) {
      if (SENSITIVE_NAME_RE.test(key)) u.searchParams.set(key, '[REDACTED]');
    }
    return redactText(u.toString());
  } catch (e) {
    return redactText(String(raw));
  }
}

/**
 * Comprueba si un texto todavía contiene alguno de los secretos literales conocidos.
 * Se usa en las pruebas de fuga y como último cortafuegos antes de responder.
 */
function containsKnownSecret(text) {
  if (typeof text !== 'string') return false;
  return secretVariants.some(({ variant }) => text.includes(variant));
}

function knownSecretCount() {
  return literalSecrets.length;
}

/** Sólo para pruebas: limpia el estado. */
function _reset() {
  literalSecrets = [];
  secretVariants = [];
}

module.exports = {
  init,
  registerSecretValue,
  redactText,
  redactValue,
  redactHeaders,
  redactUrl,
  containsKnownSecret,
  knownSecretCount,
  SENSITIVE_NAME_RE,
  NAME_ONLY_KEYS,
  _reset,
};
