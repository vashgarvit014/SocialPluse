// Faithful port of src/app/api/vary-image/route.ts (Phase 11 — genuine
// AI-provider business logic the Phase 7 ai-service extraction never
// covered; it only covered generate-content/generate-image). Describes an
// uploaded image as a rich prompt for /image to generate a fresh
// variation from — no pixels are copied.
const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
// minimaxai/minimax-m3 went end-of-life on 2026-09-09 (410 Gone), so Llama
// vision is currently the only usable vision model on this endpoint — same
// as content.mjs's own vision path.
const VARY_MODELS = ['meta/llama-3.2-11b-vision-instruct'];

export async function varyImage({ imageData, style }) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return { error: 'NVIDIA API key not configured', status: 500 };
  if (!imageData || typeof imageData !== 'string') return { error: 'imageData (data URL) is required', status: 400 };

  const url = imageData.startsWith('data:') ? imageData : `data:image/jpeg;base64,${imageData}`;
  const styleHint = typeof style === 'string' && style ? ` in a ${style} style` : '';
  let lastError = 'Vision models are slow right now — please retry.';

  for (const model of VARY_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(NVIDIA_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url } },
              { type: 'text', text: `Describe this image as a single rich paragraph prompt for an AI image generator to create a similar-but-new variation${styleHint}. Visual details only (subject, setting, composition, colors, lighting, mood) - no preamble, no commentary, no quotes, just the prompt.` },
            ],
          }],
          max_tokens: 400,
          temperature: 0.6,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) { lastError = `Vision API error (${model}): ${res.status}`; continue; }
      const data = await res.json();
      const prompt = (data.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
      if (prompt.length < 20) continue;
      return { prompt, success: true, model };
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error && err.name === 'AbortError' ? `Vision timeout (${model})` : String(err);
    }
  }
  return { error: lastError, status: 503 };
}
