import { NextRequest, NextResponse } from 'next/server';

// In-memory job store so image generation can run as a background job
// instead of inside one held-open HTTP request. gpt-image-2 via Pollinations
// deliberately has no timeout (can run 60-90s+), and the public Cloudflare
// tunnel this app is served through has its own ~100s edge limit on a single
// proxied request - past that, Cloudflare serves its own HTML timeout page
// instead of relaying the app's real (successful) JSON response, even though
// the server finished the work fine. Returning a jobId immediately and
// polling for the result keeps every individual request short, so the tunnel
// limit no longer matters no matter how long generation actually takes.
// NOTE: single-instance only (same constraint as the publish-attempt
// registries elsewhere in this app) - a server restart drops in-flight jobs.
interface ImageJob {
  status: 'pending' | 'done' | 'error' | 'blocked';
  image?: string;
  model?: string;
  message?: string;
  createdAt: number;
}
const jobs = new Map<string, ImageJob>();
const JOB_TTL_MS = 15 * 60 * 1000;

function cleanupJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { prompt, style, size } = await request.json();

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    // Map style to enhance the prompt
    const styleMap: Record<string, string> = {
      'photographic': 'photorealistic, high quality photography, detailed',
      'digital-art': 'digital art, vibrant colors, illustration',
      'cinematic': 'cinematic lighting, dramatic, movie quality',
      'anime': 'anime style, Japanese animation, colorful',
    };

    const styleText = styleMap[style as keyof typeof styleMap] || styleMap['photographic'];
    const enhancedPrompt = `${prompt}, ${styleText}`;

    const width = size?.width || 768;
    const height = size?.height || 768;

    // Use Pollinations authenticated API with user's API key
    const apiKey = process.env.POLLINATIONS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Pollinations API key not configured' },
        { status: 500 }
      );
    }

    const PRIMARY_MODEL = 'gpt-image-2'; // Only model — no fallback, no timeout limit (user requested)

    cleanupJobs();
    const jobId = `img_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    jobs.set(jobId, { status: 'pending', createdAt: Date.now() });

    // Fire-and-forget: this process stays alive (next dev / a long-running
    // node server, not a serverless function that dies on response), so the
    // call keeps running after we respond below and writes its result into
    // the job store whenever it actually finishes.
    (async () => {
      try {
        console.log(`[Image] Calling ${PRIMARY_MODEL} via POST (size: ${width}x${height}, no timeout)... job ${jobId}`);
        const response = await fetch('https://gen.pollinations.ai/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: enhancedPrompt,
            model: PRIMARY_MODEL,
            size: `${width}x${height}`,
            response_format: 'b64_json',
            n: 1,
          }),
        });
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[Image] ${PRIMARY_MODEL} failed: ${response.status} - ${errorText.slice(0, 300)}`);
          // Azure's content-safety filter rejects gibberish/vague prompts with
          // a 400. Retrying the same words never works - surface it distinctly
          // so the UI can explain that instead of a generic "unavailable".
          if (response.status === 400 && /safety system/i.test(errorText)) {
            jobs.set(jobId, { status: 'blocked', model: PRIMARY_MODEL, createdAt: Date.now() });
            return;
          }
          jobs.set(jobId, { status: 'error', model: PRIMARY_MODEL, message: `${PRIMARY_MODEL} is currently unavailable. Please try again in a moment — no fallback will be used (hold).`, createdAt: Date.now() });
          return;
        }
        const data = await response.json();
        const imageBase64 = data.data?.[0]?.b64_json;
        if (!imageBase64) {
          console.error(`[Image] ${PRIMARY_MODEL} returned no b64`);
          jobs.set(jobId, { status: 'error', model: PRIMARY_MODEL, message: `${PRIMARY_MODEL} returned no image data. Please try again.`, createdAt: Date.now() });
          return;
        }
        const mime = imageBase64.startsWith('iVBORw0KGgo') ? 'image/png' : 'image/jpeg';
        console.log(`[Image] Generated with ${PRIMARY_MODEL} ✅ ${Math.round(imageBase64.length / 1024)}KB, job ${jobId}`);
        jobs.set(jobId, { status: 'done', image: `data:${mime};base64,${imageBase64}`, model: PRIMARY_MODEL, createdAt: Date.now() });
      } catch (err) {
        console.error(`[Image] ${PRIMARY_MODEL} failed:`, err instanceof Error ? err.message : err);
        jobs.set(jobId, { status: 'error', model: PRIMARY_MODEL, message: 'Network error reaching the image model. Please try again.', createdAt: Date.now() });
      }
    })();

    return NextResponse.json({ jobId, status: 'pending' }, { status: 202 });
  } catch (error) {
    console.error('Error starting image generation:', error);
    return NextResponse.json(
      { error: 'Failed to start image generation' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  const job = jobs.get(jobId);
  if (!job) return NextResponse.json({ error: 'Unknown or expired job' }, { status: 404 });
  return NextResponse.json({
    status: job.status,
    image: job.image,
    model: job.model,
    message: job.message,
  });
}
