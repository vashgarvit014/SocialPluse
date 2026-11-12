// Shared structured logger for microservices. Pure utility, no business logic.
// Emits one JSON line per event: { service, level, timestamp, requestId?, ...fields }.
// Callers must never pass password/otp/accessToken/refreshToken/clientSecret fields —
// this module does not redact, it trusts the caller the same way the monolith's
// console.error call sites already do.

const FORBIDDEN_KEYS = new Set(['password', 'otp', 'accessToken', 'refreshToken', 'clientSecret', 'token', 'secret']);

function assertSafe(fields) {
  for (const key of Object.keys(fields || {})) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`[logger] refused to log forbidden field "${key}"`);
    }
  }
}

// Access logs must never carry query strings. OAuth callbacks arrive as
// /api/<provider>/callback?code=...&state=..., so logging req.url verbatim
// writes single-use authorization codes and CSRF state to disk for every
// provider. Callers log the pathname only.
export function requestPath(url) {
  const value = String(url || '');
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

export function createLogger(service) {
  function emit(level, fields) {
    assertSafe(fields);
    const entry = { service, level, timestamp: new Date().toISOString(), ...fields };
    const line = JSON.stringify(entry);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }
  return {
    info: (fields) => emit('info', fields),
    warn: (fields) => emit('warn', fields),
    error: (fields) => emit('error', fields),
  };
}
