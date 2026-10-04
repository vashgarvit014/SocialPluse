import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/api';
import { logSystem } from '@/lib/system-log';
import { recordAiUsage } from '@/lib/ai-usage';
import { saveMediaAsset } from '@/lib/media-assets';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import {
  MODERATION_USER_MESSAGE,
  moderatePrompt,
  promptFingerprint,
  providerSafetyDecision,
} from '@/lib/moderation';
import { recordModerationDecision } from '@/lib/moderation-escalation';

// In-memory job store so image generation can run as a background job
// instead of inside one held-open HTTP request. gpt-image-2 via Pollinations
// deliberately has no timeout (can run 60-90s+), and the public Cloudflare
// tunnel this app is served through has its own ~100s edge limit on a single
// proxied request - past that, Cloudflare serves its own HTML timeout page
// instead of relaying the app's real (successful) JSON response, even though
// the server finished the work fine. Returning a jobId immediately and
// polling for the result keeps every individual request short, so the tunnel
// limit no longer matters no matter how long generation actually takes.
// NOTE: single-instance only (same constraint as the publish-attempt
// registries elsewhere in this app) - a server restart drops in-flight jobs.
interface ImageJob {
  status: 'pending' | 'done' | 'error' | 'blocked';
  image?: string;
  model?: string;
  message?: string;
  // Owning SocialPulse account. The job store is module-global, so without
  // this any authenticated user could poll another user's jobId and receive
  // their generated image. jobIds were also Date.now()+Math.random(), which is
  // enumerable within the same millisecond window.
  userId: string;
  // Set once the generated image has been persisted as a MediaAsset, so the
  // Asset Gallery can pick it up.
  assetId?: string;
  filename?: string;
  createdAt: number;
}
const jobs = new Map<string, ImageJob>();
const JOB_TTL_MS = 15 * 60 * 1000;

function cleanupJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const { prompt, style, size } = await request.json();

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    // Rate limit BEFORE moderation so a client spamming blocked prompts cannot
    // use the classifier as an amplification vector. Reuses the existing
    // PostgreSQL-backed counter - no new infrastructure.
    if (!(await checkRateLimit(`generate_image:user:${session.userId}`, 30, 3600))) {
      return NextResponse.json(
        { error: 'Too many image requests. Please try again later.' },
        { status: 429 }
      );
    }

    // ---- Content moderation, BEFORE any provider call ----------------------
    // A blocked request must not reach the image model, must not be persisted,
    // and must not produce a MediaAsset. Doing this after generation would
    // still leave the image in the Asset Gallery.
    const moderation = await moderatePrompt(String(prompt));
    if (moderation.decision !== 'ALLOW') {
      const escalation = await recordModerationDecision(moderation, {
        userId: session.userId,
        decision: moderation.decision,
        method: moderation.method,
        action: 'BLOCKED_BEFORE_GENERATION',
        provider: moderation.provider ?? null,
        reason: moderation.reason ?? undefined,
        promptFingerprint: promptFingerprint(String(prompt)),
        safeMetadata: { style: typeof style === 'string' ? style : 'unspecified' },
      });
      return NextResponse.json(
        {
          error: MODERATION_USER_MESSAGE,
          code: 'CONTENT_SAFETY_BLOCKED',
          moderation: {
            decision: moderation.decision,
            // Surfaced so the UI can adapt its wording, NOT so a client could
            // treat this as advisory — the request is already refused.
            violationCount: escalation.count,
            flagged: escalation.flagged,
            severity: escalation.severity,
          },
        },
        { status: 422 },
      );
    }

    // Map style to enhance the prompt
    const styleMap: Record<string, string> = {
      'photographic': 'photorealistic, high quality photography, detailed',
      'digital-art': 'digital art, vibrant colors, illustration',
      'cinematic': 'cinematic lighting, dramatic, movie quality',
      'anime': 'anime style, Japanese animation, colorful',
    };

    const styleText = styleMap[style as keyof typeof styleMap] || styleMap['photographic'];
    const enhancedPrompt = `${prompt}, ${styleText}`;

    const width = size?.width || 768;
    const height = size?.height || 768;

    // Use Pollinations authenticated API with user's API key. A second key
    // (POLLINATIONS_API_KEY_FALLBACK) is tried if the primary key's request
    // fails for a reason other than content-safety (e.g. rate limit/quota) —
    // the model itself still has no fallback (see PRIMARY_MODEL below).
    const apiKey = process.env.POLLINATIONS_API_KEY;
    const fallbackApiKey = process.env.POLLINATIONS_API_KEY_FALLBACK;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Pollinations API key not configured' },
        { status: 500 }
      );
    }

    const PRIMARY_MODEL = 'gpt-image-2'; // Only model — no fallback, no timeout limit (user requested)

    cleanupJobs();
    // crypto CSPRNG: jobId is the only thing standing between one user and
    // another's generated image, so it must not be predictable. The previous
    // value was Date.now() + Math.random(), enumerable within one millisecond.
    const jobId = `img_${randomBytes(18).toString('base64url')}`;
    jobs.set(jobId, { status: 'pending', userId: session.userId, createdAt: Date.now() });
    const genStartedAt = Date.now();

    // Wraps jobs.set for the three terminal states so every exit path
    // records usage exactly once, instead of repeating recordAiUsage() at
    // five separate call sites below (easy to miss one on a future edit).
    const actorId = session.userId;
    function setTerminalJob(job: ImageJob) {
      jobs.set(jobId, job);
      recordAiUsage({ type: 'IMAGE', provider: PRIMARY_MODEL, success: job.status === 'done', durationMs: Date.now() - genStartedAt, userId: actorId });
      logSystem({
        level: job.status === 'done' ? 'SUCCESS' : 'ERROR',
        category: 'AI',
        event: job.status === 'done' ? 'IMAGE_GENERATION_SUCCESS' : 'IMAGE_GENERATION_FAILED',
        userId: actorId,
        message: job.status === 'done' ? 'Image generated' : `Image generation failed (${job.status})`,
        metadata: { durationMs: Date.now() - genStartedAt },
        requestId: jobId,
      });
    }

    // Fire-and-forget: this process stays alive (next dev / a long-running
    // node server, not a serverless function that dies on response), so the
    // call keeps running after we respond below and writes its result into
    // the job store whenever it actually finishes.
    (async () => {
      try {
        const callPollinations = (key: string) => fetch('https://gen.pollinations.ai/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: enhancedPrompt,
            model: PRIMARY_MODEL,
            size: `${width}x${height}`,
            response_format: 'b64_json',
            n: 1,
          }),
        });

        console.log(`[Image] Calling ${PRIMARY_MODEL} via POST (size: ${width}x${height}, no timeout)... job ${jobId}`);
        let response = await callPollinations(apiKey);
        let usedFallbackKey = false;
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[Image] ${PRIMARY_MODEL} failed with primary key: ${response.status} - ${errorText.slice(0, 300)}`);
          // Azure's content-safety filter rejects gibberish/vague prompts with
          // a 400. Retrying the same words (even with a different key) never
          // works - surface it distinctly instead of burning the fallback key.
          if (response.status === 400 && /safety system/i.test(errorText)) {
            // Layer 2: the provider's own verdict. Authoritative even though the
            // classifier let this through, and it must count as a confirmed
            // attempt.
            const providerVerdict = providerSafetyDecision(response.status, errorText);
            if (providerVerdict) {
              await recordModerationDecision(providerVerdict, {
                userId: actorId,
                decision: providerVerdict.decision,
                method: providerVerdict.method,
                action: 'BLOCKED_BY_IMAGE_PROVIDER',
                provider: providerVerdict.provider ?? null,
                reason: providerVerdict.reason ?? undefined,
                promptFingerprint: promptFingerprint(String(prompt)),
                safeMetadata: { stage: 'primary-key', style: typeof style === 'string' ? style : 'unspecified' },
              });
            }
            setTerminalJob({ status: 'blocked', model: PRIMARY_MODEL, userId: actorId, createdAt: Date.now() });
            return;
          }
          if (!fallbackApiKey) {
            setTerminalJob({ status: 'error', model: PRIMARY_MODEL, userId: actorId, message: `${PRIMARY_MODEL} is currently unavailable. Please try again in a moment — no fallback will be used (hold).`, createdAt: Date.now() });
            return;
          }
          console.log(`[Image] Retrying ${PRIMARY_MODEL} with fallback Pollinations key... job ${jobId}`);
          usedFallbackKey = true;
          response = await callPollinations(fallbackApiKey);
          if (!response.ok) {
            const fallbackErrorText = await response.text();
            console.error(`[Image] ${PRIMARY_MODEL} failed with fallback key too: ${response.status} - ${fallbackErrorText.slice(0, 300)}`);
            if (response.status === 400 && /safety system/i.test(fallbackErrorText)) {
              setTerminalJob({ status: 'blocked', model: PRIMARY_MODEL, userId: actorId, createdAt: Date.now() });
              return;
            }
            setTerminalJob({ status: 'error', model: PRIMARY_MODEL, userId: actorId, message: `${PRIMARY_MODEL} is currently unavailable on both keys. Please try again in a moment.`, createdAt: Date.now() });
            return;
          }
        }
        if (usedFallbackKey) console.log(`[Image] Fallback Pollinations key succeeded, job ${jobId}`);
        const data = await response.json();
        const imageBase64 = data.data?.[0]?.b64_json;
        if (!imageBase64) {
          console.error(`[Image] ${PRIMARY_MODEL} returned no b64`);
          setTerminalJob({ status: 'error', model: PRIMARY_MODEL, userId: actorId, message: `${PRIMARY_MODEL} returned no image data. Please try again.`, createdAt: Date.now() });
          return;
        }
        const mime = imageBase64.startsWith('iVBORw0KGgo') ? 'image/png' : 'image/jpeg';
        console.log(`[Image] Generated with ${PRIMARY_MODEL} ✅ ${Math.round(imageBase64.length / 1024)}KB, job ${jobId}`);

        // Persist to the user's Asset Gallery. Without this the generated image
        // existed only as a base64 string in this in-memory job and vanished on
        // reload — it was never a MediaAsset, so it never appeared in the
        // gallery and had no retention window. saveMediaAsset stamps
        // user_id = the session user and expires_at = created_at + 30 days.
        let assetId: string | undefined;
        let filename: string | undefined;
        try {
          const bytes = Buffer.from(imageBase64, 'base64');
          const asset = await saveMediaAsset({
            userId: actorId,
            filename: `ai-${Date.now().toString(36)}.${mime === 'image/png' ? 'png' : 'jpg'}`,
            mime,
            bytes,
            source: 'AI_GENERATED',
            altText: typeof prompt === 'string' ? prompt.slice(0, 300) : null,
          });
          assetId = asset.id;
          filename = asset.filename;
          logSystem({
            level: 'SUCCESS', category: 'MEDIA', event: 'MEDIA_GENERATED', userId: actorId, resourceId: asset.id,
            message: `AI image generated and saved to Asset Gallery (${asset.filename})`,
            metadata: { filename: asset.filename, size: asset.size, source: 'AI_GENERATED', model: PRIMARY_MODEL, expiresAt: asset.expiresAt },
            requestId: jobId,
          });
        } catch (persistErr) {
          // Failing to file it in the gallery must not throw away the user's
          // generated image — they still get it inline, and can re-save.
          console.error('[Image] could not persist generated media:', persistErr instanceof Error ? persistErr.message : persistErr);
        }

        setTerminalJob({ status: 'done', image: `data:${mime};base64,${imageBase64}`, model: PRIMARY_MODEL, userId: actorId, assetId, filename, createdAt: Date.now() });
      } catch (err) {
        console.error(`[Image] ${PRIMARY_MODEL} failed:`, err instanceof Error ? err.message : err);
        setTerminalJob({ status: 'error', model: PRIMARY_MODEL, userId: actorId, message: 'Network error reaching the image model. Please try again.', createdAt: Date.now() });
      }
    })();

    return NextResponse.json({ jobId, status: 'pending' }, { status: 202 });
  } catch (error) {
    console.error('Error starting image generation:', error);
    return NextResponse.json(
      { error: 'Failed to start image generation' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  const job = jobs.get(jobId);
  // A job belonging to another user is reported as unknown rather than
  // forbidden — a 403 here would confirm that the guessed id is real.
  if (!job || job.userId !== session.userId) {
    if (job) {
      logSystem({
        level: 'WARN', category: 'MEDIA', event: 'UNAUTHORIZED_RESOURCE_ACCESS_ATTEMPT', userId: session.userId,
        resourceId: jobId, message: 'Image job requested by a different user',
      });
    }
    return NextResponse.json({ error: 'Unknown or expired job' }, { status: 404 });
  }
  return NextResponse.json({
    status: job.status,
    image: job.image,
    model: job.model,
    message: job.message,
    // Lets the client show "Saved to Asset Gallery" and refresh it.
    assetId: job.assetId,
    filename: job.filename,
  });
}
