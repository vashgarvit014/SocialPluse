// Faithful port of src/app/api/generate-image/route.ts's Pollinations call
// (primary key -> fallback key, gpt-image-2 only, no model fallback/timeout
// — "user requested", per the original's own comment, preserved as-is).

// --- Previous model (disabled 2026-11-01) --- gpt-image-2 is paid_only on
// Pollinations: every configured key (primary, fallback, and a third tested
// live) returned 402 "available paid balance is 0.0000" even though the
// same account holds real Quest pollen — confirmed live that gpt-image-2
// specifically will not draw from Quest balance, only paid. Kept here, not
// deleted, so generation can be rolled back to gpt-image-2 in one uncomment
// once the account is topped up with real paid balance.
// const PRIMARY_MODEL = 'gpt-image-2';
// Verified live: real image generated in 8.78s, b64 payload confirmed
// non-empty, drawing successfully against Quest pollen (paid_only: false
// per Pollinations' own /v1/models catalog).
const PRIMARY_MODEL = 'black-forest-labs/flux.2-klein-4b';

export { PRIMARY_MODEL };

export async function callPollinations({ prompt, style, width, height, apiKey }) {
  const styleMap = {
    'photographic': 'photorealistic, high quality photography, detailed',
    'digital-art': 'digital art, vibrant colors, illustration',
    'cinematic': 'cinematic lighting, dramatic, movie quality',
    'anime': 'anime style, Japanese animation, colorful',
  };
  const styleText = styleMap[style] || styleMap['photographic'];
  const enhancedPrompt = `${prompt}, ${styleText}`;

  return fetch('https://gen.pollinations.ai/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: enhancedPrompt, model: PRIMARY_MODEL, size: `${width}x${height}`, response_format: 'b64_json', n: 1 }),
  });
}
