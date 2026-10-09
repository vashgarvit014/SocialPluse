// Shared Multiple Images ("carousel") media-count rules — 1–9 images.
// Mirror of packages/validation/carousel.mjs (apps/web cannot import
// repo-root packages from its Docker build context — see the validation
// package's README). tests/carousel-rules.cjs asserts the two copies stay
// identical.

export const MIN_CAROUSEL_MEDIA = 1;
export const MAX_CAROUSEL_MEDIA = 9;

export const CAROUSEL_MIN_MESSAGE = 'Add at least 1 image.';
export const CAROUSEL_MAX_MESSAGE = 'You can add up to 9 images.';

// null when the count is acceptable, otherwise the user-facing message.
export function carouselMediaIssue(count: number): string | null {
  if (count < MIN_CAROUSEL_MEDIA) return CAROUSEL_MIN_MESSAGE;
  if (count > MAX_CAROUSEL_MEDIA) return CAROUSEL_MAX_MESSAGE;
  return null;
}
