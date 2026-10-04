// Classifies a publishing-service error code as transient (worth a bounded
// retry) or permanent (never retry automatically) — per the brief's
// explicit list. Bounded, backoff-spaced retries only; permanent errors go
// straight to FAILED.

const TRANSIENT_CODES = new Set([
  'LINKEDIN_RATE_LIMIT', 'LINKEDIN_PUBLISH_FAILED',
  'FACEBOOK_RATE_LIMIT', 'FACEBOOK_PUBLISH_FAILED',
  'INSTAGRAM_RATE_LIMIT', 'INSTAGRAM_PUBLISH_FAILED',
  'WHAPI_RATE_LIMIT', 'WHAPI_SERVER_ERROR', 'WHAPI_PUBLISH_FAILED', 'WHAPI_REQUEST_FAILED',
  'PUBLISH_FAILED', // timeout / unexpected error from the gateway/service layer itself
]);

// Everything else — *_NOT_CONNECTED, *_AUTH_EXPIRED, *_PERMISSION_DENIED,
// *_MEDIA_*, *_CAROUSEL_*, WHATSAPP_NOT_CHANNEL_OWNER, WHAPI_GROUP_NOT_FOUND,
// DUPLICATE_PUBLISH_REQUEST, etc. — is permanent: retrying won't help
// (disconnected, denied, or a bad destination stays bad) and would just
// burn more attempts against a provider that already said no.
export function isTransientError(code) {
  return TRANSIENT_CODES.has(code);
}

// Bounded: 3 attempts total (1 original + 2 retries), exponential-ish
// backoff. Matches the brief's worked example (attempt, delay, attempt,
// delay, attempt, then FAILED).
const BACKOFF_MS = [2 * 60 * 1000, 10 * 60 * 1000]; // 2min, then 10min
export const MAX_ATTEMPTS = 3;

export function nextRetry(retryCount, now = Date.now()) {
  if (retryCount >= MAX_ATTEMPTS - 1) return null; // no more retries
  const delay = BACKOFF_MS[retryCount] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  return new Date(now + delay).toISOString();
}
