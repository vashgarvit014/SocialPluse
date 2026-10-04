// Due-job execution loop. Faithful port of the publish-building logic from
// src/app/api/scheduler/check/route.ts#publishPost, BUT calling
// publishing-service's internal endpoints directly (x-internal-secret +
// x-actor-user-id) instead of looping back through the monolith's own
// /api/{platform}/publish over HTTP with a signed actor header — this is
// the "scheduler -> publishing-service" boundary the brief requires
// ("scheduler must NOT call LinkedIn/Facebook/Instagram/Whapi directly").
//
// Stable attemptId `sched:${post.id}:${platform}` preserved exactly from
// the original — this is what lets publishing-service's durable
// idempotency (publish_attempts UNIQUE(platform, attempt_id)) catch a
// retried/duplicate claim of the same post+platform and refuse to publish
// it twice, even if THIS service's own claim/lock bookkeeping is ever
// imperfect (crash between claim and finishJob, etc.) — defense in depth,
// not the only guard.

import { isTransientError, nextRetry, MAX_ATTEMPTS } from './retry-policy.mjs';

const PLATFORM_ROUTE = { linkedin: '/linkedin', facebook: '/facebook', instagram: '/instagram', whatsapp: '/whapi' };

function stripAllHashtags(s) {
  return s.replace(/#[A-Za-z0-9_]+/g, ' ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function createWorker({ store, log, publishingServiceUrl, internalSecret, workerId, pollIntervalMs = 15_000 }) {
  let lastLoopAt = null;
  let running = false;
  let timer = null;

  async function publishOnePlatform(post, platform, account) {
    const route = PLATFORM_ROUTE[platform];
    if (!route) return { ok: false, code: 'PUBLISH_FAILED', message: `Unknown platform ${platform}` };

    const mediaList = post.mediaList;
    const mediaUrls = post.mediaUrls || mediaList?.map((m) => m.url);
    const mediaUrl = post.mediaUrl || post.videoUrl || post.imageUrl || mediaUrls?.[0];
    const mediaType = post.mediaType || (post.videoUrl ? 'video' : post.imageUrl ? 'image' : undefined) || mediaList?.[0]?.type;
    const isVideo = mediaType === 'video' || mediaList?.some((m) => m.type === 'video');
    const isWhapp = platform === 'whatsapp';

    const content = post.platformContent?.[platform]
      ? (isWhapp ? stripAllHashtags(post.platformContent[platform].caption) : [post.platformContent[platform].caption, (post.platformContent[platform].hashtags || []).map((t) => '#' + t.replace(/^#+/, '')).join(' ')].filter(Boolean).join('\n\n'))
      : (isWhapp ? stripAllHashtags(post.content) : post.content);

    const body = {
      content,
      imageUrl: !isVideo ? post.imageUrl || mediaUrl : undefined,
      videoUrl: isVideo ? post.videoUrl || mediaUrl : undefined,
      mediaUrl, mediaType,
      mediaUrls: mediaUrls || (mediaUrl ? [mediaUrl] : undefined),
      mediaList,
      isCarousel: post.isCarousel === true || undefined,
      trialReel: post.trialReel === true ? true : undefined,
      collaborator: post.collaborator || post.editorState?.collaborator || undefined,
      pageId: account.pageId,
      // Whapi uses groupId, not pageId/userId.
      groupId: isWhapp ? (account.pageId || account.userId) : undefined,
      attemptId: `sched:${post.id}:${platform}`,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(`${publishingServiceUrl}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret, 'x-actor-user-id': post.userId },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) return { ok: true };
      // A duplicate-claim response means another attempt already claimed
      // this exact post+platform's attemptId — but that prior attempt could
      // itself have FAILED (e.g. this exact scenario: a permanently-failed
      // job later re-claimed by a manual retry/test reset, reusing the same
      // stable attemptId). Blindly treating "duplicate" as success would
      // mark a post PUBLISHED when it never actually was — found by testing
      // this exact path, not assumed safe. Look up what actually happened.
      if (data.code === 'DUPLICATE_PUBLISH_REQUEST' || data.code === 'WHAPI_DUPLICATE_REQUEST') {
        const outcome = await store.getAttemptOutcome(platform === 'whatsapp' ? 'whapi' : platform, body.attemptId);
        if (outcome?.status === 'SUCCESS') return { ok: true, postId: outcome.providerPostId, duplicate: true };
        return { ok: false, code: data.code, message: 'A prior attempt for this post already failed; it was not published.' };
      }
      return { ok: false, code: data.code || 'PUBLISH_FAILED', message: data.message };
    } catch (e) {
      return { ok: false, code: 'PUBLISH_FAILED', message: e instanceof Error ? e.message : 'Network error' };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function runOnce() {
    const claimed = await store.claimDueJob(workerId, { now: new Date() });
    let publishedCount = 0;
    for (const post of claimed) {
      if (!post.userId) {
        log.warn({ event: 'publish_skipped_unowned', postId: post.id });
        await store.finishJob(post.id, { status: 'failed', retryCount: post.retry_count || 0 });
        continue;
      }
      const results = [];
      for (const platform of post.platforms || []) {
        const account = (post.accounts || []).find((a) => a.platform === platform);
        if (!account) { results.push({ platform, ok: false, code: 'PUBLISH_FAILED' }); continue; }
        const result = await publishOnePlatform(post, platform, account);
        results.push({ platform, ...result });
        log.info({ event: result.ok ? 'publish_success' : 'publish_failed', postId: post.id, platform, code: result.code });
      }

      const anySuccess = results.some((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      const allTransient = failed.length > 0 && failed.every((r) => isTransientError(r.code));
      const retryCount = post.retry_count || 0;

      if (anySuccess || failed.length === 0) {
        await store.finishJob(post.id, { status: 'published', retryCount, failedPlatforms: failed.length ? failed.map((f) => f.platform) : undefined });
        publishedCount++;
      } else if (allTransient && retryCount < MAX_ATTEMPTS - 1) {
        const retryAt = nextRetry(retryCount);
        await store.finishJob(post.id, { status: 'pending', retryCount: retryCount + 1, nextRetryAt: retryAt });
        log.info({ event: 'publish_retry_scheduled', postId: post.id, retryCount: retryCount + 1, retryAt });
      } else {
        await store.finishJob(post.id, { status: 'failed', retryCount, failedPlatforms: failed.map((f) => f.platform) });
      }
    }
    lastLoopAt = new Date().toISOString();
    return publishedCount;
  }

  function start() {
    if (running) return;
    running = true;
    const loop = async () => {
      try { await runOnce(); } catch (e) { log.error({ event: 'worker_loop_error', message: e instanceof Error ? e.message : 'unknown' }); }
      if (running) timer = setTimeout(loop, pollIntervalMs);
    };
    loop();
  }

  function stop() {
    running = false;
    if (timer) clearTimeout(timer);
  }

  return { start, stop, runOnce, status: () => ({ running, lastLoopAt }) };
}
