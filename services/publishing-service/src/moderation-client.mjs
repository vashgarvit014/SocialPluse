// Thin service-to-service client — same shape as ai-service's own
// moderation-escalation.mjs (which itself is a thin client to user-service).
// publishing-service never writes moderation state itself; it only calls
// ai-service to classify text and user-service to record the outcome.
import { randomUUID } from 'node:crypto';
import { internalFetchHeaders } from '../packages/service-auth/index.mjs';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-service:4003';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service:4010';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

// Reuses the SAME classifier as AI-generation prompts (no new model, no new
// external API) — just run over publish-time captions/hashtags instead.
export async function checkText(text) {
  const res = await fetch(`${AI_SERVICE_URL}/internal/moderate/text`, {
    method: 'POST',
    headers: internalFetchHeaders(INTERNAL_SECRET, randomUUID(), { 'content-type': 'application/json' }),
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`ai-service moderation check failed: ${res.status} ${body.error || body.message || 'unknown'}`);
  }
  return res.json();
}

export async function recordIncident({ userId, result, source, platform, contentPreview, idempotencyKey, action, reason }) {
  const res = await fetch(`${USER_SERVICE_URL}/internal/users/${userId}/moderation/decision`, {
    method: 'POST',
    headers: internalFetchHeaders(INTERNAL_SECRET, randomUUID(), { 'content-type': 'application/json' }),
    body: JSON.stringify({
      decision: result.decision, method: result.method, countsAsViolation: result.countsAsViolation, confidence: result.confidence ?? null,
      action, provider: result.provider ?? null, reason: reason ?? result.reason,
      source, platform: platform ?? null, idempotencyKey,
      contentPreview: contentPreview ?? null, safeMetadata: { pipeline: 'publish' },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`user-service moderation decision call failed: ${res.status} ${body.error || body.message || 'unknown'}`);
  }
  return res.json();
}
