// Shared helper for the WhatsApp Business Platform (Cloud API) Groups
// integration. Same Graph API version already used elsewhere in this app
// (facebook/publish, instagram/publish) for consistency.
const GRAPH = 'https://graph.facebook.com/v21.0';

export function getWhatsAppConfig(): { phoneNumberId: string; accessToken: string } | null {
  if (process.env.WHATSAPP_ENABLED === 'false') return null;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
  if (!phoneNumberId || !accessToken) return null;
  return { phoneNumberId, accessToken };
}

export interface WhatsAppApiError {
  code: string;
  message: string;
}

// Maps Meta's Graph API error shape to the same {code, message} contract
// every other publish route in this app uses.
export function whatsAppError(status: number, body: string, context: string): WhatsAppApiError {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: number; error_subcode?: number; type?: string } };
    detail = parsed.error?.message || '';
    if (parsed.error?.type === 'OAuthException' || status === 401) {
      return { code: 'WHATSAPP_AUTH_EXPIRED', message: `WhatsApp authentication expired during ${context}. Regenerate the access token.` };
    }
  } catch { /* fall through to status mapping */ }
  if (status === 403) {
    return { code: 'WHATSAPP_PERMISSION_DENIED', message: `WhatsApp denied permission during ${context} (403). Check the token's permissions and the number's Official Business Account status.` };
  }
  if (status === 429) {
    return { code: 'WHATSAPP_RATE_LIMIT', message: 'WhatsApp rate limit reached (429). Please wait and try again.' };
  }
  const suffix = detail ? ` ${detail.slice(0, 250)}` : '';
  return { code: 'WHATSAPP_REQUEST_FAILED', message: `WhatsApp request failed during ${context} (${status}).${suffix}` };
}

// Thin fetch wrapper: prefixes the Graph host/version and attaches the
// bearer token. `path` starts with '/' and is either a phone-number-id-
// relative or group-id-relative path - callers build the full path since
// the two ID spaces are unrelated.
export async function waFetch(path: string, accessToken: string, init?: RequestInit): Promise<Response> {
  return fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });
}
