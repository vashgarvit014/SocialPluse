// Due-job execution loop.
//
// One post is claimed atomically (claimDueJob, FOR UPDATE SKIP LOCKED), then
// its TARGET PLATFORMS ARE PROCESSED INDEPENDENTLY. There is no transaction
// spanning provider calls: an external publish cannot be rolled back, and one
// platform failing must never discard another platform's success. Database
// bookkeeping per platform is transactional in itself; the publish calls are
// not grouped.
//
// Order per platform:
//   1. preflight the user's CURRENT connection (scoped to post.userId)
//   2. disconnected -> CONNECTION_REQUIRED, no outbound publish at all
//   3. connected    -> atomically claim the platform row -> PROCESSING
//   4. publish through publishing-service, then record the real outcome
//
// Stable attemptId `sched:${post.id}:${platform}` is preserved exactly — it is
// what lets publishing-service's durable idempotency (publish_attempts UNIQUE)
// refuse a second publish of the same post+platform even if this service's own
// bookkeeping is ever interrupted mid-flight.

import { isTransientError, nextRetry, MAX_ATTEMPTS } from './retry-policy.mjs';
import { POST_STATUS, PLATFORM_STATUS, resolveOverallStatus, summarizePlatforms } from './status.mjs';

const PLATFORM_ROUTE = { linkedin: '/linkedin', facebook: '/facebook', instagram: '/instagram', whatsapp: '/whapi' };

// Publishing-service error codes that mean "the user has disconnected this
// platform" — surfaced by its own credential reads (disconnected_at IS NULL)
// as well as by our preflight. Either way the correct outcome is
// CONNECTION_REQUIRED, never a generic FAILED and never a retry.
const CONNECTION_ERROR_CODES = new Set([
  'LINKEDIN_NOT_CONNECTED', 'FACEBOOK_NOT_CONNECTED', 'INSTAGRAM_NOT_CONNECTED',
  'WHATSAPP_NOT_CHANNEL_OWNER', 'PLATFORM_NOT_CONNECTED', 'AUTH_REQUIRED',
]);

const PLATFORM_LABEL = { linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram', whatsapp: 'WhatsApp' };

function stripAllHashtags(s) {
  return s.replace(/#[A-Za-z0-9_]+/g, ' ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// Plain-JS mirror of apps/web/src/lib/posts.ts's normalizeLegacyCollaborator
// — kept in sync by hand, same pattern as stripAllHashtags being duplicated
// across services. Reads either the current `collaborators` array or a
// pre-migration `collaborator` string, and strips UI-only fields
// (status/lastUpdatedAt/note) before sending to publishing-service, which
// only needs {username, type}.
function collaboratorsForPublish(post) {
  const current = post.collaborators || post.editorState?.collaborators;
  if (Array.isArray(current) && current.length) {
    return current.map((c) => ({ username: c.username, type: c.type === 'private' ? 'private' : 'professional' }));
  }
  const legacy = post.collaborator || post.editorState?.collaborator;
  if (typeof legacy !== 'string' || !legacy.trim()) return undefined;
  const usernames = legacy.split(/[,\s]+/).map((c) => c.trim().replace(/^@+/, '')).filter(Boolean).slice(0, 3);
  return usernames.length ? usernames.map((username) => ({ username, type: 'professional' })) : undefined;
}

export function createWorker({
  store, platformStore, connections, notifier, log,
  publishingServiceUrl, internalSecret, workerId, pollIntervalMs = 15_000,
}) {
  let lastLoopAt = null;
  let running = false;
  let timer = null;
  let lastStats = { due: 0, published: 0, partial: 0, connectionRequired: 0, failed: 0, retrying: 0 };

  function buildBody(post, platform, account) {
    const mediaList = post.mediaList;
    const mediaUrls = post.mediaUrls || mediaList?.map((m) => m.url);
    const mediaUrl = post.mediaUrl || post.videoUrl || post.imageUrl || mediaUrls?.[0];
    const mediaType = post.mediaType || (post.videoUrl ? 'video' : post.imageUrl ? 'image' : undefined) || mediaList?.[0]?.type;
    const isVideo = mediaType === 'video' || mediaList?.some((m) => m.type === 'video');
    const isWhapp = platform === 'whatsapp';

    const content = post.platformContent?.[platform]
      ? (isWhapp
        ? stripAllHashtags(post.platformContent[platform].caption)
        : [post.platformContent[platform].caption, (post.platformContent[platform].hashtags || []).map((t) => '#' + t.replace(/^#+/, '')).join(' ')].filter(Boolean).join('\n\n'))
      : (isWhapp ? stripAllHashtags(post.content) : post.content);

    return {
      content,
      imageUrl: !isVideo ? post.imageUrl || mediaUrl : undefined,
      videoUrl: isVideo ? post.videoUrl || mediaUrl : undefined,
      mediaUrl, mediaType,
      mediaUrls: mediaUrls || (mediaUrl ? [mediaUrl] : undefined),
      mediaList,
      isCarousel: post.isCarousel === true || undefined,
      trialReel: post.trialReel === true ? true : undefined,
      collaborators: collaboratorsForPublish(post),
      pageId: account?.pageId,
      // Whapi uses groupId, not pageId/userId.
      groupId: isWhapp ? (account?.pageId || account?.userId) : undefined,
      attemptId: `sched:${post.id}:${platform}`,
      origin: 'SCHEDULED',
    };
  }

  async function callPublish(post, platform, account) {
    const route = PLATFORM_ROUTE[platform];
    if (!route) return { ok: false, code: 'UNSUPPORTED_PLATFORM', message: `Unknown platform ${platform}` };

    const body = buildBody(post, platform, account);
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
      if (res.ok && data.success) return { ok: true, externalPostId: data.postId || null, collaboratorResults: data.collaborators, postUrl: data.postUrl };

      // A duplicate-claim response means a prior attempt already claimed this
      // exact post+platform attemptId — but that prior attempt could itself
      // have FAILED. Blindly treating "duplicate" as success would mark a post
      // PUBLISHED when it never was. Look up what actually happened.
      if (data.code === 'DUPLICATE_PUBLISH_REQUEST' || data.code === 'WHAPI_DUPLICATE_REQUEST') {
        const outcome = await store.getAttemptOutcome(platform === 'whatsapp' ? 'whapi' : platform, body.attemptId);
        if (outcome?.status === 'SUCCESS') return { ok: true, externalPostId: outcome.providerPostId || null, duplicate: true };
        return { ok: false, code: data.code || 'PUBLISH_FAILED', message: 'A prior attempt for this post already failed; it was not published.' };
      }
      return { ok: false, code: data.code || 'PUBLISH_FAILED', message: data.message || 'Publish failed.', collaboratorResults: data.collaborators };
    } catch (e) {
      return { ok: false, code: 'PUBLISH_FAILED', message: e instanceof Error ? e.message : 'Network error' };
    } finally {
      clearTimeout(timeout);
    }
  }

  // Merges a publishing-service collaboratorResults response into the post's
  // persisted collaborators array and writes it back. This is the only path
  // that updates collaborator status for a scheduled (non-instant) publish —
  // there's no browser present to do it the way the instant-publish path
  // does. Informational only: called after finishPlatform(), so a failure or
  // crash here never affects the authoritative per-platform delivery row.
  async function persistCollaboratorResults(post, collaboratorResults, postUrl) {
    const hasResults = Array.isArray(collaboratorResults) && collaboratorResults.length && Array.isArray(post.collaborators) && post.collaborators.length;
    if (!hasResults && !postUrl) return;
    try {
      await store.updateUserPost(post.userId, post.id, (current) => {
        let collaborators = current.collaborators;
        if (hasResults) {
          const results = new Map(collaboratorResults.map((r) => [r.username, r]));
          collaborators = (current.collaborators || []).map((c) => {
            const r = results.get(c.username);
            return r ? { ...c, status: r.status, lastUpdatedAt: new Date().toISOString() } : c;
          });
        }
        return { ...current, collaborators, instagramPostUrl: postUrl || current.instagramPostUrl };
      });
    } catch (e) {
      log.warn({ userId: post.userId, scheduledPostId: post.id, event: 'COLLABORATOR_STATUS_PERSIST_FAILED', message: e instanceof Error ? e.message : 'unknown' });
    }
  }

  /**
   * Process exactly one platform. Never throws — always returns a result so a
   * failure here cannot abort the loop over the remaining platforms.
   */
  async function processPlatform(post, platform, account, rowIndex) {
    const userId = post.userId;
    const logBase = { userId, scheduledPostId: post.id, platform };

    // Already went out — a re-claim of this post (bounded retry, stale-lock
    // recovery, or "Retry failed") must never publish it a second time.
    if (rowIndex?.status === PLATFORM_STATUS.PUBLISHED) {
      log.info({ ...logBase, event: 'PLATFORM_SKIP_ALREADY_PUBLISHED' });
      return { platform, ok: true, skipped: true, externalPostId: rowIndex.externalPostId };
    }

    // --- CONNECTION PREFLIGHT (authoritative; no publish call if it fails) ---
    const pf = await connections.preflight(userId, platform, account || {});
    if (!pf.ok) {
      await platformStore.finishPlatform(post.id, userId, platform, {
        status: PLATFORM_STATUS.CONNECTION_REQUIRED,
        errorCode: pf.code,
        errorMessage: pf.message,
      });
      log.warn({ ...logBase, event: 'PLATFORM_CONNECTION_REQUIRED', errorCode: pf.code });
      await notifier?.notify({
        userId,
        type: 'PLATFORM_CONNECTION_REQUIRED',
        title: `${PLATFORM_LABEL[platform] || platform} disconnected`,
        message: `Your scheduled ${PLATFORM_LABEL[platform] || platform} post could not be published because ${PLATFORM_LABEL[platform] || platform} is disconnected. Reconnect ${PLATFORM_LABEL[platform] || platform} and retry.`,
        metadata: { scheduledPostId: post.id, platform, errorCode: pf.code },
      });
      return { platform, ok: false, connectionRequired: true, code: pf.code, message: pf.message };
    }

    // --- ATOMIC PLATFORM CLAIM: PENDING/FAILED/CONNECTION_REQUIRED -> PROCESSING ---
    const claimed = await platformStore.claimPlatform(post.id, platform, userId, {
      connectionId: pf.connectionId, destination: pf.destination,
    });
    if (!claimed) {
      // Another worker holds it, or it is already PUBLISHED. Either way: skip.
      log.info({ ...logBase, event: 'PLATFORM_CLAIM_SKIPPED' });
      return { platform, ok: false, skipped: true, code: 'PLATFORM_CLAIMED_ELSEWHERE' };
    }

    log.info({ ...logBase, event: 'PLATFORM_PUBLISH_STARTED', attempt: claimed.attemptCount });
    const result = await callPublish(post, platform, account);

    if (result.ok) {
      await platformStore.finishPlatform(post.id, userId, platform, {
        status: PLATFORM_STATUS.PUBLISHED, externalPostId: result.externalPostId,
      });
      log.info({ ...logBase, event: 'PLATFORM_PUBLISH_SUCCESS', externalPostId: result.externalPostId || null });
      if (platform === 'instagram') await persistCollaboratorResults(post, result.collaboratorResults, result.postUrl);
      return { platform, ok: true, externalPostId: result.externalPostId };
    }

    const connectionFailed = CONNECTION_ERROR_CODES.has(result.code);
    const status = connectionFailed ? PLATFORM_STATUS.CONNECTION_REQUIRED : PLATFORM_STATUS.FAILED;
    await platformStore.finishPlatform(post.id, userId, platform, {
      status, errorCode: result.code, errorMessage: result.message,
    });
    if (platform === 'instagram') await persistCollaboratorResults(post, result.collaboratorResults);
    log.warn({ ...logBase, event: connectionFailed ? 'PLATFORM_CONNECTION_REQUIRED' : 'PLATFORM_PUBLISH_FAILED', errorCode: result.code });
    if (connectionFailed) {
      await notifier?.notify({
        userId,
        type: 'PLATFORM_CONNECTION_REQUIRED',
        title: `${PLATFORM_LABEL[platform] || platform} disconnected`,
        message: `Your scheduled ${PLATFORM_LABEL[platform] || platform} post could not be published because ${PLATFORM_LABEL[platform] || platform} is disconnected. Reconnect ${PLATFORM_LABEL[platform] || platform} and retry.`,
        metadata: { scheduledPostId: post.id, platform, errorCode: result.code },
      });
    }
    return { platform, ok: false, connectionRequired: connectionFailed, code: result.code, message: result.message };
  }

  async function publishOnePost(post) {
    const userId = post.userId;
    const logBase = { userId, scheduledPostId: post.id };
    log.info({ ...logBase, event: 'SCHEDULED_PUBLISH_STARTED', platforms: (post.platforms || []).join(',') });

    // Legacy rows scheduled before per-platform tracking have no rows yet.
    let platformRows = await platformStore.listForPostUnscoped(post.id);
    if (!platformRows.length) {
      await platformStore.syncForPost(post.id, userId, (post.platforms || []).map((p) => ({ platform: p })));
      platformRows = await platformStore.listForPostUnscoped(post.id);
    }

    const results = [];
    for (const platform of post.platforms || []) {
      const account = (post.accounts || []).find((a) => a.platform === platform);
      const rowIndex = platformRows.find((r) => r.platform === platform);
      const result = await processPlatform(post, platform, account, rowIndex);
      // A skipped platform counts as satisfied for the aggregate — it already
      // published in an earlier attempt.
      results.push(result.skipped && result.ok ? { platform, ok: true, ...result } : result);
    }

    // Re-read: every platform write above just landed.
    const fresh = await platformStore.listForPostUnscoped(post.id);
    const summary = summarizePlatforms(fresh);
    const anyTransientFailure = results.some((r) => !r.ok && !r.skipped && !r.connectionRequired && isTransientError(r.code));
    const anyConnectionFailure = results.some((r) => r.connectionRequired && !r.skipped);
    const retryCount = post.retry_count || 0;

    let nextStatus;
    let nextRetryAt = null;
    let nextRetryCount = retryCount;

    const allSettled = fresh.every((r) => r.status === PLATFORM_STATUS.PUBLISHED || r.status === PLATFORM_STATUS.FAILED || r.status === PLATFORM_STATUS.CONNECTION_REQUIRED);
    const allPublished = fresh.length > 0 && fresh.every((r) => r.status === PLATFORM_STATUS.PUBLISHED);

    if (allPublished) {
      nextStatus = POST_STATUS.PUBLISHED;
    } else if (allSettled && anyTransientFailure && retryCount < MAX_ATTEMPTS - 1) {
      // Bounded retry: only the platforms that are not PUBLISHED get
      // re-processed, because processPlatform skips PUBLISHED rows.
      nextStatus = POST_STATUS.SCHEDULED;
      nextRetryAt = nextRetry(retryCount);
      nextRetryCount = retryCount + 1;
    } else {
      nextStatus = resolveOverallStatus(fresh, { postStatus: undefined });
    }

    await store.finishJob(post.id, { status: nextStatus, retryCount: nextRetryCount, nextRetryAt });

    // --- NOTIFICATIONS (terminal states only; a retry in flight stays quiet) ---
    if (nextStatus === POST_STATUS.PUBLISHED) {
      log.info({ ...logBase, event: 'SCHEDULED_POST_COMPLETE', result: 'published' });
      await notifier?.notify({
        userId, type: 'SCHEDULED_POST_PUBLISHED',
        title: 'Scheduled post published',
        message: `Your scheduled post was published to ${summary.published} of ${summary.total} platform${summary.total === 1 ? '' : 's'}.`,
        metadata: { scheduledPostId: post.id, published: summary.published, total: summary.total },
      });
    } else if (nextStatus === POST_STATUS.PARTIALLY_PUBLISHED) {
      log.warn({ ...logBase, event: 'SCHEDULED_POST_PARTIAL_SUCCESS', published: summary.published, total: summary.total });
      await notifier?.notify({
        userId, type: 'SCHEDULED_POST_PARTIAL_SUCCESS',
        title: 'Scheduled post partially published',
        message: `${summary.headline} ${summary.detail}`.trim(),
        metadata: { scheduledPostId: post.id, published: summary.published, total: summary.total, reconnect: summary.reconnectPlatforms, failed: summary.failedPlatforms },
      });
    } else if (nextStatus === POST_STATUS.CONNECTION_REQUIRED || nextStatus === POST_STATUS.FAILED) {
      log.error({ ...logBase, event: 'SCHEDULED_POST_COMPLETE', result: nextStatus, errorCode: fresh.find((r) => r.errorCode)?.errorCode || null });
      await notifier?.notify({
        userId, type: 'SCHEDULED_POST_FAILED',
        title: 'Scheduled post could not be published',
        message: summary.detail || 'Your scheduled post could not be published. Open the scheduler to review and retry.',
        metadata: { scheduledPostId: post.id, published: summary.published, total: summary.total, status: nextStatus },
      });
    } else if (nextStatus === POST_STATUS.SCHEDULED) {
      log.info({ ...logBase, event: 'SCHEDULED_POST_RETRY_SCHEDULED', retryAt: nextRetryAt, attempt: nextRetryCount });
    }

    return { status: nextStatus, summary };
  }

  /**
   * Publish exactly ONE already-claimed post. Used by the user-triggered
   * "Retry failed" path so a retry can never sweep in unrelated due posts
   * the way runOnce() would.
   */
  async function publishClaimed(post) {
    return publishOnePost(post);
  }

  async function runOnce() {
    const claimed = await store.claimDueJob(workerId, { now: new Date() });
    const stats = { due: claimed.length, published: 0, partial: 0, connectionRequired: 0, failed: 0, retrying: 0 };
    for (const post of claimed) {
      if (!post.userId) {
        // No owner (legacy import) — cannot resolve a connection, must not publish.
        log.warn({ event: 'publish_skipped_unowned', scheduledPostId: post.id });
        await store.finishJob(post.id, { status: POST_STATUS.FAILED, retryCount: post.retry_count || 0 });
        continue;
      }
      try {
        const outcome = await publishOnePost(post);
        if (outcome.status === POST_STATUS.PUBLISHED) stats.published++;
        else if (outcome.status === POST_STATUS.PARTIALLY_PUBLISHED) stats.partial++;
        else if (outcome.status === POST_STATUS.CONNECTION_REQUIRED) stats.connectionRequired++;
        else if (outcome.status === POST_STATUS.FAILED) stats.failed++;
        else if (outcome.status === POST_STATUS.SCHEDULED) stats.retrying++;
      } catch (e) {
        // One post's unexpected error must not stop the whole tick.
        log.error({ event: 'scheduled_post_error', userId: post.userId, scheduledPostId: post.id, message: e instanceof Error ? e.message : 'unknown' });
        try { await store.finishJob(post.id, { status: POST_STATUS.FAILED, retryCount: post.retry_count || 0 }); } catch { /* already finalized */ }
      }
    }
    lastStats = stats;
    lastLoopAt = new Date().toISOString();
    if (claimed.length) {
      log.info({ event: 'scheduler_tick', ...stats });
    }
    return stats.published;
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

  return { start, stop, runOnce, publishClaimed, status: () => ({ running, lastLoopAt, stats: lastStats }) };
}
