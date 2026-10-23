// Single choke-point moderation check, called by every publish handler in
// server.mjs (LinkedIn/Facebook/Instagram/Whapi) before the real platform
// API call — covers both instant publish (gateway -> here directly) and
// scheduled publish (scheduler-service's callPublish() hits the exact same
// HTTP routes). Reuses the SAME text classifier already used for
// AI-generation prompts (via ai-service's /internal/moderate/text) — no new
// classifier, no new paid API.
import { createHash } from 'node:crypto';
import { checkText, recordIncident } from './moderation-client.mjs';

function categoryFor(decision) {
  if (decision === 'BLOCK_NUDITY') return 'NUDITY';
  if (decision === 'BLOCK_EXPLICIT_SEXUAL') return 'EXPLICIT_SEXUAL';
  if (decision === 'BLOCK_SUGGESTIVE') return 'SUGGESTIVE';
  if (decision === 'BLOCK_MINOR_SEXUAL') return 'MINOR_SEXUAL';
  if (decision === 'BLOCK_OTHER_SAFETY') return 'OTHER_SAFETY';
  return 'NONE';
}

// Publish-time copy is deliberately distinct from the AI-generation prompt
// copy (ai-service's moderationBlockCopy) — "your post was blocked" reads
// very differently from "please revise your prompt". Never populate
// content_preview for the two sexual/CSAM-adjacent categories.
const BLOCK_COPY = {
  NUDITY: { title: 'Content Policy Violation Detected', message: 'This post was blocked because it appears to contain nudity, which violates our content safety policy.', sensitive: true },
  EXPLICIT_SEXUAL: { title: 'Content Policy Violation Detected', message: 'This post was blocked because it appears to contain explicit sexual content, which violates our content safety policy.', sensitive: true },
  SUGGESTIVE: { title: 'Content Policy Violation Detected', message: 'This post was blocked because it appears to contain sexually suggestive content, which violates our content safety policy.', sensitive: true },
  MINOR_SEXUAL: { title: 'Content Policy Violation Detected', message: 'This post was blocked — it cannot be processed.', sensitive: true },
  OTHER_SAFETY: { title: 'Content Policy Violation Detected', message: 'This post was blocked because it violates our content safety policy.', sensitive: false },
};

function flattenContent(content, hashtags) {
  const tags = Array.isArray(hashtags) ? hashtags.join(' ') : '';
  return [content, tags].filter(Boolean).join('\n\n').trim();
}

/**
 * @returns {Promise<{ allowed: true } | { allowed: false, status: number, body: object }>}
 */
export async function assertContentAllowed({ userId, content, hashtags, platform, source, attemptId }) {
  const text = flattenContent(content, hashtags);
  if (!text) return { allowed: true };

  const idempotencyKey = createHash('sha256').update(`${userId}|${source}|${attemptId}`).digest('hex');

  let result;
  try {
    result = await checkText(text);
  } catch (e) {
    // Scanner outage is an infra event, not a moderation event — never
    // silently allow (would defeat the gate) and never penalize the user
    // for our own classifier being down. No moderation_incidents/
    // moderation_events row is written at all.
    return {
      allowed: false, status: 503,
      body: { success: false, code: 'MODERATION_UNAVAILABLE', message: 'Content could not be verified right now — please retry.', detail: e instanceof Error ? e.message : undefined },
    };
  }

  if (result.decision === 'ALLOW') return { allowed: true };

  const isUncertain = result.decision === 'NEEDS_CLARIFICATION';
  const category = categoryFor(result.decision);
  // Uncertain results exist specifically for ambiguous sexual/nudity
  // framing — never show a content preview for those either.
  const sensitive = isUncertain || BLOCK_COPY[category]?.sensitive === true;

  await recordIncident({
    userId, result, source, platform, idempotencyKey,
    action: 'BLOCKED_BEFORE_PUBLISH',
    contentPreview: sensitive ? null : text.slice(0, 280),
  });

  if (isUncertain) {
    return {
      allowed: false, status: 422,
      body: {
        success: false, code: 'CONTENT_UNDER_REVIEW', category: 'UNCERTAIN',
        title: 'Content Under Review',
        message: "We're unable to verify this content right now. It wasn't published. You can try again, or contact support if this keeps happening.",
      },
    };
  }

  const copy = BLOCK_COPY[category] || BLOCK_COPY.OTHER_SAFETY;
  return {
    allowed: false, status: 422,
    body: {
      success: false, code: 'CONTENT_POLICY_VIOLATION', category,
      title: copy.title, message: copy.message,
    },
  };
}
