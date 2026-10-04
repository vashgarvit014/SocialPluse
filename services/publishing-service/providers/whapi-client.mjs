// Same port as integrations-service/providers/whatsapp/whapi-client.mjs —
// duplicated rather than shared, consistent with this migration's existing
// per-service duplication of small provider helpers.
export function whapiError(status, body, context) {
  let detail = '';
  let detailsField = '';
  try {
    const parsed = JSON.parse(body);
    detail = parsed.error?.message || '';
    detailsField = parsed.error?.details || '';
  } catch { /* not JSON */ }
  const suffix = (detailsField || detail) ? ` ${(detailsField || detail).slice(0, 250)}` : '';
  if (status === 401) return { code: 'WHAPI_UNAUTHORIZED', message: `Whapi authentication failed during ${context} (401). Check WHAPI_API_TOKEN.${suffix}` };
  if (status === 403) return { code: 'WHAPI_PERMISSION_DENIED', message: `Whapi denied permission during ${context} (403).${suffix}` };
  if (status === 402) return { code: 'WHAPI_TRIAL_LIMIT', message: `Whapi trial limit exceeded during ${context} (402).${suffix}` };
  if (status === 429) return { code: 'WHAPI_RATE_LIMIT', message: `Whapi rate limit reached (429) during ${context}. Please wait and try again.${suffix}` };
  if (status === 400) {
    const combined = `${detail} ${detailsField} ${body}`.slice(0, 1000);
    if (/community parent/i.test(combined)) return { code: 'WHAPI_COMMUNITY_PARENT', message: `This WhatsApp community cannot receive messages directly. Select its announcement group instead.${suffix}` };
    return { code: 'WHAPI_BAD_REQUEST', message: `Whapi bad request during ${context} (400).${suffix}` };
  }
  if (status >= 500) return { code: 'WHAPI_SERVER_ERROR', message: `Whapi server error during ${context} (${status}). Please try again.${suffix}` };
  return { code: 'WHAPI_REQUEST_FAILED', message: `Whapi request failed during ${context} (${status}).${suffix}` };
}

export async function whapiFetch(path, token, init, baseUrl) {
  const url = `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
  return fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
}
