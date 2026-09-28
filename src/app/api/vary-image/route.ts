import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/api';

const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
// minimaxai/minimax-m3 went end-of-life on 2026-09-09 (410 Gone), so Llama
// vision is currently the only usable vision model on this endpoint.
const VARY_MODELS = ['meta/llama-3.2-11b-vision-instruct'];

// POST /api/vary-image { imageData, style? }
// Describes the uploaded image as a rich image-generation prompt so the
// client can feed it straight into /api/generate-image for a fresh AI
// variation. No pixels are copied - the new image is generated from text.
export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const { imageData, style } = await request.json();
    if (!imageData || typeof imageData !== 'string') {
      return NextResponse.json({ error: 'imageData (data URL) is required' }, { status: 400 });
    }
    if (!NVIDIA_API_KEY) {
      return NextResponse.json({ error: 'NVIDIA API key not configured' }, { status: 500 });
    }

    const url = imageData.startsWith('data:') ? imageData : `data:image/jpeg;base64,${imageData}`;
    const styleHint = typeof style === 'string' && style ? ` in a ${style} style` : '';
    let lastError = 'Vision models are slow right now — please retry.';

    for (const model of VARY_MODELS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      try {
        console.log(`[Vary] describing image with ${model}`);
        const res = await fetch(NVIDIA_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` },
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
        if (!res.ok) {
          console.error(`[Vary] ${model} API error:`, res.status);
          lastError = `Vision API error (${model}): ${res.status}`;
          continue;
        }
        const data = await res.json();
        const prompt = (data.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
        if (prompt.length < 20) {
          console.log(`[Vary] ${model} returned too little, trying next`);
          continue;
        }
        console.log(`[Vary] prompt from ${model}: ${prompt.length} chars`);
        return NextResponse.json({ prompt, success: true, model });
      } catch (err) {
        clearTimeout(timer);
        lastError = err instanceof Error && err.name === 'AbortError' ? `Vision timeout (${model})` : String(err);
        console.log(`[Vary] ${model} failed: ${lastError}`);
      }
    }

    return NextResponse.json({ error: lastError }, { status: 503 });
  } catch (error) {
    console.error('[Vary] error:', error);
    return NextResponse.json({ error: 'Failed to describe image' }, { status: 500 });
  }
}
