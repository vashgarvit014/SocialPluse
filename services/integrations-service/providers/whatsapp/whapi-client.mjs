// Faithful port of the relevant parts of src/app/api/whapi/client.ts
// (whapiFetch/whapiError/maskPhone) — error-code mapping kept byte-for-byte
// so messages shown to users don't drift from the monolith's existing ones.

const DEFAULT_BASE = 'https://gate.whapi.cloud';

export function whapiError(status, body, context) {
  let detail = '';
  let detailsField = '';
  try {
    const parsed = JSON.parse(body);
    detail = parsed.error?.message || '';
    detailsField = parsed.error?.details || '';
  } catch { /* body may not be JSON */ }
  const suffix = (detailsField || detail) ? ` ${(detailsField || detail).slice(0, 250)}` : '';

  if (status === 401) return { code: 'WHAPI_UNAUTHORIZED', message: `Whapi authentication failed during ${context} (401). Check WHAPI_API_TOKEN.${suffix}` };
  if (status === 403) return { code: 'WHAPI_PERMISSION_DENIED', message: `Whapi denied permission during ${context} (403).${suffix}` };
  if (status === 402) return { code: 'WHAPI_TRIAL_LIMIT', message: `Whapi trial limit exceeded during ${context} (402).${suffix}` };
  if (status === 429) return { code: 'WHAPI_RATE_LIMIT', message: `Whapi rate limit reached (429) during ${context}. Please wait and try again.${suffix}` };
  if (status === 400) return { code: 'WHAPI_BAD_REQUEST', message: `Whapi bad request during ${context} (400).${suffix}` };
  if (status >= 500) return { code: 'WHAPI_SERVER_ERROR', message: `Whapi server error during ${context} (${status}). Please try again.${suffix}` };
  return { code: 'WHAPI_REQUEST_FAILED', message: `Whapi request failed during ${context} (${status}).${suffix}` };
}

export async function whapiFetch(path, token, init, baseUrl = DEFAULT_BASE) {
  const url = `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
  return fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
}

export function maskPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return phone ? '****' : '';
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
}
