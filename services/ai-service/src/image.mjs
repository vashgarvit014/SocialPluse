// Faithful port of src/app/api/generate-image/route.ts's Pollinations call
// (primary key -> fallback key, gpt-image-2 only, no model fallback/timeout
// — "user requested", per the original's own comment, preserved as-is).

const PRIMARY_MODEL = 'gpt-image-2';

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
