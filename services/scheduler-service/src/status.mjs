// Overall ScheduledPost status, derived ONLY from its per-platform rows.
//
// Single source of truth for every caller (worker, retry path, scheduler API,
// UI). Deliberately a pure function over already-loaded rows so it can be
// unit-tested without a database and can never drift from what the worker
// actually writes.
//
// Storage convention (matches the pre-existing scheduled_posts.status values
// this system has always used — lowercase — so no data migration and no
// frontend statusBadge breakage):
//
//   DRAFT               -> 'draft'
//   SCHEDULED           -> 'pending'   (pending == scheduled, historical name)
//   PROCESSING          -> 'publishing'
//   PUBLISHED           -> 'published'
//   PARTIALLY_PUBLISHED -> 'partially_published'   (new)
//   FAILED              -> 'failed'
//   CONNECTION_REQUIRED -> 'connection_required'   (new)
//   CANCELLED           -> 'cancelled'
//
// Per-platform rows (scheduled_post_platforms.status) use the UPPERCASE names
// from the spec, since that table is new and has no legacy readers.

export const PLATFORM_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
  CONNECTION_REQUIRED: 'CONNECTION_REQUIRED',
  CANCELLED: 'CANCELLED',
});

export const POST_STATUS = Object.freeze({
  DRAFT: 'draft',
  SCHEDULED: 'pending',
  PROCESSING: 'publishing',
  PUBLISHED: 'published',
  PARTIALLY_PUBLISHED: 'partially_published',
  FAILED: 'failed',
  CONNECTION_REQUIRED: 'connection_required',
  CANCELLED: 'cancelled',
});

// Statuses a platform row may be re-claimed from. PROCESSING and PUBLISHED are
// intentionally absent: re-claiming either would risk a duplicate post.
export const RETRYABLE_PLATFORM_STATUSES = Object.freeze([
  PLATFORM_STATUS.PENDING,
  PLATFORM_STATUS.FAILED,
  PLATFORM_STATUS.CONNECTION_REQUIRED,
]);

// A scheduled post is eligible for the worker only from this state.
export const SCHEDULABLE_POST_STATUSES = Object.freeze([POST_STATUS.SCHEDULED]);

/**
 * Resolve the overall post status from its platform rows.
 *
 * @param {Array<{status: string}>} platformRows
 * @param {{ postStatus?: string }} [opts] current row status, used only to
 *        distinguish an untouched future post from one already started.
 * @returns {string} one of POST_STATUS
 */
export function resolveOverallStatus(platformRows, opts = {}) {
  const rows = Array.isArray(platformRows) ? platformRows : [];
  const current = opts.postStatus;

  // Terminal user-driven states are never overwritten by a derivation over
  // zero rows (a draft/cancelled post has no platform rows by design).
  if (rows.length === 0) {
    if (current === POST_STATUS.DRAFT || current === POST_STATUS.CANCELLED) return current;
    if (current === POST_STATUS.SCHEDULED || current === POST_STATUS.PROCESSING) return current;
    return current || POST_STATUS.SCHEDULED;
  }

  // An untouched future post stays SCHEDULED until the worker claims it.
  const anyClaimed = rows.some((r) => r.status !== PLATFORM_STATUS.PENDING && r.status !== PLATFORM_STATUS.CANCELLED);
  if (!anyClaimed && current === POST_STATUS.SCHEDULED) return POST_STATUS.SCHEDULED;

  const active = rows.filter((r) => r.status !== PLATFORM_STATUS.CANCELLED);
  if (active.length === 0) return current || POST_STATUS.SCHEDULED;

  const counts = active.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const published = counts[PLATFORM_STATUS.PUBLISHED] || 0;
  const connectionRequired = counts[PLATFORM_STATUS.CONNECTION_REQUIRED] || 0;
  const processing = counts[PLATFORM_STATUS.PROCESSING] || 0;
  const failed = counts[PLATFORM_STATUS.FAILED] || 0;
  const pending = counts[PLATFORM_STATUS.PENDING] || 0;
  const total = active.length;

  // Anything still in flight means the post as a whole is PROCESSING.
  if (processing > 0 || pending > 0) {
    if (published > 0) return POST_STATUS.PROCESSING; // partial result already in
    return POST_STATUS.PROCESSING;
  }

  if (published === total) return POST_STATUS.PUBLISHED;

  if (published === 0 && connectionRequired === total) return POST_STATUS.CONNECTION_REQUIRED;
  if (published === 0 && failed === total) return POST_STATUS.FAILED;
  if (published === 0 && failed + connectionRequired === total) {
    // Mixed hard failures with nothing published — report the more actionable
    // of the two when every row is unrecoverable, favouring reconnection
    // because that is the one the user can actually fix.
    return connectionRequired >= failed ? POST_STATUS.CONNECTION_REQUIRED : POST_STATUS.FAILED;
  }

  if (published > 0) return POST_STATUS.PARTIALLY_PUBLISHED;
  if (connectionRequired > 0) return POST_STATUS.CONNECTION_REQUIRED;
  return POST_STATUS.FAILED;
}

/**
 * Human summary for the UI / notification body, e.g.
 * "Published to 3 of 4 platforms." + "Instagram requires reconnection."
 */
export function summarizePlatforms(platforms) {
  const rows = Array.isArray(platforms) ? platforms : [];
  const total = rows.length;
  const published = rows.filter((r) => r.status === PLATFORM_STATUS.PUBLISHED).length;
  const reconnect = rows.filter((r) => r.status === PLATFORM_STATUS.CONNECTION_REQUIRED).map((r) => r.platform);
  const failed = rows.filter((r) => r.status === PLATFORM_STATUS.FAILED).map((r) => r.platform);
  const label = (p) => (p === 'linkedin' ? 'LinkedIn' : p === 'whatsapp' ? 'WhatsApp' : p.charAt(0).toUpperCase() + p.slice(1));
  return {
    total,
    published,
    allPublished: total > 0 && published === total,
    anyConnectionRequired: reconnect.length > 0,
    reconnectPlatforms: reconnect,
    failedPlatforms: failed,
    headline: total ? `Published to ${published} of ${total} platform${total === 1 ? '' : 's'}.` : '',
    detail: [
      reconnect.length ? `${reconnect.map(label).join(', ')} require${reconnect.length === 1 ? 's' : ''} reconnection.` : '',
      failed.length ? `${failed.map(label).join(', ')} failed.` : '',
    ].filter(Boolean).join(' '),
  };
}
