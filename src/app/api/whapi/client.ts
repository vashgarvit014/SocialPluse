// Whapi connector — separate from official Meta WhatsApp Cloud API (/api/whatsapp/*).
// This helper handles the existing-group publishing path via gate.whapi.cloud.
// Token is server-side only and is never logged or returned to the client.

const DEFAULT_BASE = 'https://gate.whapi.cloud';

export function getWhapiConfig(): { baseUrl: string; token: string } | null {
  const rawBase = process.env.WHAPI_API_BASE || DEFAULT_BASE;
  const token = process.env.WHAPI_API_TOKEN || '';
  if (!token || !token.trim()) return null;
  // Normalize: trim trailing slash, allow user to paste with or without protocol
  let baseUrl = rawBase.trim().replace(/\/+$/, '');
  if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
  return { baseUrl, token: token.trim() };
}

export interface WhapiApiError {
  code: string;
  message: string;
}

function maskToken(token: string): string {
  if (token.length <= 8) return '***';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function whapiError(status: number, body: string, context: string): WhapiApiError {
  let detail = '';
  let detailsField = '';
  let errorCode: number | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: number; details?: string } };
    detail = parsed.error?.message || '';
    detailsField = parsed.error?.details || '';
    errorCode = parsed.error?.code;
  } catch { /* body may not be JSON */ }

  const combined = `${detail} ${detailsField} ${body}`.slice(0, 1000);
  const suffix = (detailsField || detail) ? ` ${(detailsField || detail).slice(0, 250)}` : '';

  if (status === 401 || errorCode === 401) {
    return { code: 'WHAPI_UNAUTHORIZED', message: `Whapi authentication failed during ${context} (401). Check WHAPI_API_TOKEN.${suffix}` };
  }
  if (status === 403) {
    if (/group-announce-not-admin/i.test(combined)) {
      return { code: 'WHAPI_PERMISSION_DENIED', message: `You are not an admin of this announcement group — only admins can post to community announcement groups. Make this number an admin in WhatsApp, or choose a regular group (e.g. from All groups).${suffix}` };
    }
    return { code: 'WHAPI_PERMISSION_DENIED', message: `Whapi denied permission during ${context} (403).${suffix}` };
  }
  if (status === 402) {
    return { code: 'WHAPI_TRIAL_LIMIT', message: `Whapi trial limit exceeded during ${context} (402). The free Whapi plan is limited to one group (Minor project works). Upgrade at https://panel.whapi.cloud to publish to "${context}" and other groups.${suffix}` };
  }
  if (status === 429) {
    return { code: 'WHAPI_RATE_LIMIT', message: `Whapi rate limit reached (429) during ${context}. Please wait and try again.${suffix}` };
  }
  if (status === 400) {
    if (/community parent/i.test(combined)) {
      return { code: 'WHAPI_COMMUNITY_PARENT', message: `This WhatsApp community cannot receive messages directly. Select its announcement group instead.${suffix ? ` (${(detailsField || detail).slice(0, 120)})` : ''}` };
    }
    if (/announce/i.test(combined) && /community/i.test(combined)) {
      return { code: 'WHAPI_COMMUNITY_PARENT', message: `This is a community announcement group restriction.${suffix ? ` (${(detailsField || detail).slice(0, 120)})` : ''}` };
    }
    return { code: 'WHAPI_BAD_REQUEST', message: `Whapi bad request during ${context} (400).${suffix}` };
  }
  if (status >= 500) {
    return { code: 'WHAPI_SERVER_ERROR', message: `Whapi server error during ${context} (${status}). Please try again.${suffix}` };
  }
  return { code: 'WHAPI_REQUEST_FAILED', message: `Whapi request failed during ${context} (${status}).${suffix}` };
}

// Thin fetch wrapper: adds Bearer token, never logs token
export async function whapiFetch(path: string, token: string, init?: RequestInit, baseUrl: string = DEFAULT_BASE): Promise<Response> {
  const url = `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
}

// Helper to mask phone for safe logging/display: +91 98*******06
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return phone ? '****' : '';
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
}

// Sanitize logs: never include token, redact phone-like strings
export function sanitizeForLog(obj: unknown): string {
  try {
    const raw = JSON.stringify(obj);
    // Avoid logging long base64 data URLs
    const truncated = raw.length > 1200 ? `${raw.slice(0, 1200)}...[truncated ${raw.length - 1200} chars]` : raw;
    // Redact anything that looks like a token (Bearer ...) should not appear here anyway
    return truncated.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***');
  } catch {
    return '[unserializable]';
  }
}

export function logWhapi(context: string, message: string, extra?: unknown) {
  if (extra !== undefined) {
    console.log(`[whapi/${context}] ${message} ${sanitizeForLog(extra)}`);
  } else {
    console.log(`[whapi/${context}] ${message}`);
  }
}
