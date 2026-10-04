// Scoped internal-service authentication, extending the monolith's
// INTERNAL_PUBLISH_SECRET pattern (src/lib/internal-auth.ts) to inter-service
// calls: every request between gateway and a backend service must carry a
// shared secret header. Not for user identity (that's the existing signed
// actor assertion) - this only proves "this call came from inside our own
// service mesh", analogous to a network-level trust boundary we don't have
// since we deliberately don't trust the Docker network alone.

import { timingSafeEqual } from 'node:crypto';

const HEADER = 'x-internal-secret';

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Verifies an incoming Node http.IncomingMessage carries the right secret. */
export function verifyInternalSecret(req, expectedSecret) {
  if (!expectedSecret) return false;
  const provided = req.headers[HEADER];
  return typeof provided === 'string' && provided.length > 0 && safeEqual(provided, expectedSecret);
}

/** Headers to attach to an outgoing inter-service fetch. */
export function internalFetchHeaders(secret, requestId, extra = {}) {
  return {
    [HEADER]: secret,
    'x-request-id': requestId,
    'content-type': 'application/json',
    ...extra,
  };
}
