// Shared Multiple Images ("carousel") media-count rules — 1–9 images.
//
// Imported by publishing-service (publish-time guard) and scheduler-service
// (schedule-time guard) so the two services can never diverge on the limits.
// apps/web mirrors these constants/messages in src/lib/carousel-rules.ts —
// it cannot import repo-root packages from its Docker build context (see
// packages/validation/README.md); tests/carousel-rules.cjs asserts the two
// copies stay identical.

export const MIN_CAROUSEL_MEDIA = 1;
export const MAX_CAROUSEL_MEDIA = 9;

// Count the media a request body actually carries, mirroring the provider
// fallback chain (mediaUrls → mediaList → single media field).
export function carouselMediaCount(body) {
  if (Array.isArray(body?.mediaUrls)) {
    const urls = body.mediaUrls.filter((u) => typeof u === 'string' && u.length > 0);
    if (urls.length) return urls.length;
  }
  if (Array.isArray(body?.mediaList)) {
    const urls = body.mediaList.map((m) => m?.url).filter((u) => typeof u === 'string' && u.length > 0);
    if (urls.length) return urls.length;
  }
  const single = [body?.mediaUrl, body?.videoUrl, body?.imageUrl].find((u) => typeof u === 'string' && u.length > 0);
  return single ? 1 : 0;
}

// null when the body is acceptable, otherwise { code, message }.
// `requireMedia: false` (in-progress draft saves) only enforces the upper
// bound, so a Multiple Images draft can be saved before any slide exists —
// the minimum is required at schedule/publish time, not at draft time.
export function carouselMediaError(body, { requireMedia = true } = {}) {
  if (body?.isCarousel !== true) return null;
  const count = carouselMediaCount(body);
  if (requireMedia && count < MIN_CAROUSEL_MEDIA) {
    return { code: 'CAROUSEL_MEDIA_MIN', message: 'Add at least 1 image.' };
  }
  if (count > MAX_CAROUSEL_MEDIA) {
    return { code: 'CAROUSEL_MEDIA_MAX', message: 'You can add up to 9 images.' };
  }
  return null;
}
