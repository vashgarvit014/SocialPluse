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
