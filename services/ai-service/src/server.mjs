import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createLogger } from '../packages/logger/index.mjs';
import { verifyInternalSecret } from '../packages/service-auth/index.mjs';
import { generateContent } from './content.mjs';
import { moderatePrompt, promptFingerprint, providerSafetyDecision, moderationBlockCopy } from './moderation.mjs';
import { createModerationStore } from './moderation-escalation.mjs';
import { createUsageRecorder } from './ai-usage.mjs';
import { createRateLimiter } from './rate-limit.mjs';
import { createMediaClient } from './media-client.mjs';
import { callPollinations, PRIMARY_MODEL } from './image.mjs';
import { varyImage } from './vary-image.mjs';
import { generateAltText } from './alt-text.mjs';

// ai-service — owns AI text/caption generation, image generation, and
// content moderation. Does NOT own media storage (hands persistence to
// media-service), scheduler timing, publishing, OAuth, or auth. Faithful
// port of src/app/api/generate-content/route.ts +
// src/app/api/generate-image/route.ts + src/lib/moderation.ts +
// src/lib/moderation-escalation.ts.
//
// NOT ported: logSystem()'s writes to the monolith's system_logs table —
// same precedent as publishing-service/scheduler-service not duplicating
// that. ai_usage_log (via ai-usage.mjs) is a durable record this service
// owns directly. moderation_events and the `users` moderation columns are,
// as of Phase 8, owned by user-service — moderation-escalation.mjs here is
// now a thin client calling user-service's internal API, not a DB writer.

const PORT = Number(process.env.PORT || 4003);
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const MEDIA_SERVICE_URL = process.env.MEDIA_SERVICE_URL || 'http://media-service:4004';
const log = createLogger('ai-service');

let pool = null;
function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  pool.on('error', (err) => log.error({ event: 'pool_error', message: err.message }));
  return pool;
}
const poolProxy = { query: (...args) => getPool().query(...args), connect: (...args) => getPool().connect(...args) };
const moderationStore = createModerationStore(poolProxy);
const recordAiUsage = createUsageRecorder(poolProxy);
const checkRateLimit = createRateLimiter(poolProxy);
const mediaClient = createMediaClient({ mediaServiceUrl: MEDIA_SERVICE_URL, internalSecret: INTERNAL_SECRET });

// In-memory image-job store — same constraint as the original route's own
// comment: "single-instance only; a server restart drops in-flight jobs."
// Not upgraded to durable storage this round (out of scope — the brief
// doesn't ask for it, and generation is synchronous-feeling from the
// user's perspective regardless, just polled instead of held open).
const jobs = new Map();
const JOB_TTL_MS = 15 * 60 * 1000;
function cleanupJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function requireActor(req) {
  const userId = req.headers['x-actor-user-id'];
  return typeof userId === 'string' && userId.length > 0 ? userId : null;
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

// --- POST /content ---
async function handleGenerateContent(req, res) {
  const userId = requireActor(req);
  if (!userId) return send(res, 401, { error: 'Unauthorized' });
  const body = await readJsonBody(req);
  const { prompt, tone, platforms, hasImage, imageData, imageDataList } = body;

  if (!prompt?.trim() && !hasImage) return send(res, 400, { error: 'Topic or image is required' });
  if (!platforms || !Array.isArray(platforms) || platforms.length === 0) return send(res, 400, { error: 'At least one platform must be selected' });
  const validPlatforms = ['linkedin', 'instagram', 'facebook', 'whatsapp'];
  const selectedPlatforms = platforms.filter((p) => validPlatforms.includes(p));
  if (selectedPlatforms.length === 0) return send(res, 400, { error: 'No valid platforms selected' });

  // Same pre-generation safety gate as image generation: an explicit,
  // suggestive, minor-sexual or genuinely ambiguous topic must not reach the
  // text model either. Only the topic text is classified (attached user
  // photos are never generated content). Recorded exactly like image blocks.
  if (prompt?.trim()) {
    const textModeration = await moderatePrompt(String(prompt));
    if (textModeration.decision !== 'ALLOW') {
      const textEscalation = await moderationStore.recordModerationDecision(textModeration, {
        userId, decision: textModeration.decision, method: textModeration.method, action: 'BLOCKED_BEFORE_GENERATION',
        provider: textModeration.provider ?? null, reason: textModeration.reason ?? undefined,
        promptFingerprint: promptFingerprint(String(prompt)), safeMetadata: { pipeline: 'content' },
      });
      const textCopy = moderationBlockCopy(textModeration.decision);
      return send(res, 422, {
        success: false, code: textCopy.code, category: textCopy.category,
        title: textCopy.title, message: textCopy.message, guidance: textCopy.guidance,
        example: textCopy.exampleInstead ? { instead: textCopy.exampleInstead, use: textCopy.exampleUse } : undefined,
        error: textCopy.message,
        moderation: { decision: textModeration.decision, violationCount: textEscalation.count, flagged: textEscalation.flagged, severity: textEscalation.severity },
      });
    }
  }

  const startedAt = Date.now();
  try {
    const result = await generateContent(prompt.trim(), selectedPlatforms, tone || 'professional', !!hasImage, imageData, Array.isArray(imageDataList) ? imageDataList : undefined);
    recordAiUsage({ type: 'CONTENT', provider: 'text-generation', success: true, durationMs: Date.now() - startedAt, userId });
    return send(res, 200, result);
  } catch (error) {
    recordAiUsage({ type: 'CONTENT', provider: 'text-generation', success: false, userId });
    return send(res, 500, { error: error instanceof Error ? error.message : 'Failed to generate content', code: 'AI_GENERATION_FAILED' });
  }
}

// --- POST /image (starts job), GET /image?jobId=... (polls) ---
async function handleStartImageJob(req, res) {
  const userId = requireActor(req);
  if (!userId) return send(res, 401, { error: 'Unauthorized' });
  const body = await readJsonBody(req);
  const { prompt, style, size } = body;
  if (!prompt) return send(res, 400, { error: 'Prompt is required' });

  if (!(await checkRateLimit(`generate_image:user:${userId}`, 30, 3600))) {
    return send(res, 429, { error: 'Too many image requests. Please try again later.' });
  }

  // Moderation BEFORE any provider call — a blocked request must not reach
  // the image model, must not be persisted, must not produce a MediaAsset.
  // The response carries per-category revision copy (title/guidance/example)
  // so the client can show a precise warning; the prompt itself is never
  // echoed back and never sent to any provider after classification.
  const moderation = await moderatePrompt(String(prompt));
  if (moderation.decision !== 'ALLOW') {
    const escalation = await moderationStore.recordModerationDecision(moderation, {
      userId, decision: moderation.decision, method: moderation.method, action: 'BLOCKED_BEFORE_GENERATION',
      provider: moderation.provider ?? null, reason: moderation.reason ?? undefined,
      promptFingerprint: promptFingerprint(String(prompt)), safeMetadata: { style: typeof style === 'string' ? style : 'unspecified' },
    });
    const copy = moderationBlockCopy(moderation.decision);
    return send(res, 422, {
      success: false, code: copy.code, category: copy.category,
      title: copy.title, message: copy.message, guidance: copy.guidance,
      example: copy.exampleInstead ? { instead: copy.exampleInstead, use: copy.exampleUse } : undefined,
      error: copy.message,
      moderation: { decision: moderation.decision, violationCount: escalation.count, flagged: escalation.flagged, severity: escalation.severity },
    });
  }

  const width = size?.width || 768;
  const height = size?.height || 768;
  const apiKey = process.env.POLLINATIONS_API_KEY;
  const fallbackApiKey = process.env.POLLINATIONS_API_KEY_FALLBACK;
  if (!apiKey) return send(res, 500, { error: 'Pollinations API key not configured', code: 'AI_SERVICE_UNAVAILABLE' });

  cleanupJobs();
  const jobId = `img_${randomBytes(18).toString('base64url')}`;
  jobs.set(jobId, { status: 'pending', userId, createdAt: Date.now() });
  const genStartedAt = Date.now();

  function setTerminalJob(job) {
    jobs.set(jobId, job);
    recordAiUsage({ type: 'IMAGE', provider: PRIMARY_MODEL, success: job.status === 'done', durationMs: Date.now() - genStartedAt, userId });
  }

  // Fire-and-forget background generation — same pattern as the original
  // (this process stays alive; the job store is how the result reaches a
  // later poll instead of holding the HTTP request open past Cloudflare's
  // ~100s edge limit).
  (async () => {
    try {
      let response = await callPollinations({ prompt, style, width, height, apiKey });
      let usedFallbackKey = false;
      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 400 && /safety system/i.test(errorText)) {
          const providerVerdict = providerSafetyDecision(response.status, errorText);
          if (providerVerdict) {
            await moderationStore.recordModerationDecision(providerVerdict, {
              userId, decision: providerVerdict.decision, method: providerVerdict.method, action: 'BLOCKED_BY_IMAGE_PROVIDER',
              provider: providerVerdict.provider ?? null, reason: providerVerdict.reason ?? undefined,
              promptFingerprint: promptFingerprint(String(prompt)), safeMetadata: { stage: 'primary-key', style: typeof style === 'string' ? style : 'unspecified' },
            });
          }
          setTerminalJob({ status: 'blocked', model: PRIMARY_MODEL, userId, createdAt: Date.now() });
          return;
        }
        if (!fallbackApiKey) {
          setTerminalJob({ status: 'error', model: PRIMARY_MODEL, userId, message: `${PRIMARY_MODEL} is currently unavailable. Please try again in a moment — no fallback will be used (hold).`, createdAt: Date.now() });
          return;
        }
        usedFallbackKey = true;
        response = await callPollinations({ prompt, style, width, height, apiKey: fallbackApiKey });
        if (!response.ok) {
          const fallbackErrorText = await response.text();
          if (response.status === 400 && /safety system/i.test(fallbackErrorText)) {
            setTerminalJob({ status: 'blocked', model: PRIMARY_MODEL, userId, createdAt: Date.now() });
            return;
          }
          setTerminalJob({ status: 'error', model: PRIMARY_MODEL, userId, message: `${PRIMARY_MODEL} is currently unavailable on both keys. Please try again in a moment.`, createdAt: Date.now() });
          return;
        }
      }
      void usedFallbackKey;
      const data = await response.json();
      const imageBase64 = data.data?.[0]?.b64_json;
      if (!imageBase64) {
        setTerminalJob({ status: 'error', model: PRIMARY_MODEL, userId, message: `${PRIMARY_MODEL} returned no image data. Please try again.`, createdAt: Date.now() });
        return;
      }
      const mime = imageBase64.startsWith('iVBORw0KGgo') ? 'image/png' : 'image/jpeg';

      // Handoff to media-service, per the brief — not written to this
      // container's filesystem at all.
      let assetId;
      let filename;
      try {
        const bytes = Buffer.from(imageBase64, 'base64');
        const result = await mediaClient.persistGeneratedImage({
          userId, filename: `ai-${Date.now().toString(36)}.${mime === 'image/png' ? 'png' : 'jpg'}`, mime, bytes,
          altText: typeof prompt === 'string' ? prompt.slice(0, 300) : null,
        });
        if (result.ok) { assetId = result.asset.id; filename = result.asset.filename; }
        else log.error({ event: 'media_persist_failed', userId, error: result.error });
      } catch (persistErr) {
        log.error({ event: 'media_persist_failed', userId, message: persistErr instanceof Error ? persistErr.message : 'unknown' });
      }

      setTerminalJob({ status: 'done', image: `data:${mime};base64,${imageBase64}`, model: PRIMARY_MODEL, userId, assetId, filename, createdAt: Date.now() });
    } catch (err) {
      setTerminalJob({ status: 'error', model: PRIMARY_MODEL, userId, message: 'Network error reaching the image model. Please try again.', createdAt: Date.now() });
    }
  })();

  return send(res, 202, { jobId, status: 'pending' });
}

function handlePollImageJob(req, res, url) {
  const userId = requireActor(req);
  if (!userId) return send(res, 401, { error: 'Unauthorized' });
  const jobId = url.searchParams.get('jobId');
  if (!jobId) return send(res, 400, { error: 'jobId is required' });
  const job = jobs.get(jobId);
  if (!job || job.userId !== userId) return send(res, 404, { error: 'Unknown or expired job' });
  return send(res, 200, { status: job.status, image: job.image, model: job.model, message: job.message, assetId: job.assetId, filename: job.filename });
}

const server = http.createServer(async (req, res) => {
  const requestId = req.headers['x-request-id'] || randomUUID();
  const start = Date.now();
  res.on('finish', () => {
    log.info({ requestId, path: req.url, method: req.method, status: res.statusCode, durationMs: Date.now() - start });
  });

  try {
    if (req.url === '/health') {
      // Lightweight: process alive + config present. No provider call.
      return send(res, 200, {
        service: 'ai-service', status: 'ok', timestamp: new Date().toISOString(),
        config: {
          pollinations: !!process.env.POLLINATIONS_API_KEY,
          mercury: !!process.env.INCEPTION_API_KEY,
          nvidia: !!process.env.NVIDIA_API_KEY,
        },
      });
    }
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) {
      return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    }

    const url = new URL(req.url, 'http://internal');
    if (url.pathname === '/content' && req.method === 'POST') return await handleGenerateContent(req, res);
    if (url.pathname === '/image' && req.method === 'POST') return await handleStartImageJob(req, res);
    if (url.pathname === '/image' && req.method === 'GET') return handlePollImageJob(req, res, url);

    // Phase 11: vary-image and alt-text moved here from the monolith's
    // /api/vary-image and /api/media/alt — genuine AI-provider calls the
    // Phase 7 extraction never covered. No usage/moderation recording for
    // either — the original monolith routes never did any either (faithful
    // port, not an enhancement).
    if (url.pathname === '/vary-image' && req.method === 'POST') {
      const userId = requireActor(req);
      if (!userId) return send(res, 401, { error: 'Unauthorized' });
      const body = await readJsonBody(req);
      const result = await varyImage(body);
      if (result.error) return send(res, result.status || 502, { error: result.error });
      return send(res, 200, result);
    }
    if (url.pathname === '/alt-text' && req.method === 'POST') {
      const userId = requireActor(req);
      if (!userId) return send(res, 401, { error: 'Unauthorized' });
      const body = await readJsonBody(req);
      const result = await generateAltText(body);
      if (result.error) return send(res, result.status || 502, { error: result.error });
      return send(res, 200, result);
    }

    return send(res, 404, { code: 'NOT_FOUND', message: 'No such ai-service route.' });
  } catch (e) {
    log.error({ requestId, event: 'unhandled_request_error', message: e instanceof Error ? e.message : 'unknown' });
    if (!res.headersSent) send(res, 500, { error: 'An unexpected error occurred. Please try again.', code: 'AI_GENERATION_FAILED' });
  }
});

server.listen(PORT, () => log.info({ event: 'listening', port: PORT }));

function shutdown(signal) {
  log.info({ event: 'shutdown_start', signal });
  server.close(() => {
    (pool ? pool.end() : Promise.resolve()).finally(() => {
      log.info({ event: 'shutdown_complete' });
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('unhandledRejection', (reason) => {
  log.error({ event: 'unhandled_rejection', message: reason instanceof Error ? reason.message : String(reason) });
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
