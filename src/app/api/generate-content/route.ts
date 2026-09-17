import { NextRequest, NextResponse } from 'next/server';

const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const NVIDIA_API_URL = `${NVIDIA_BASE_URL.replace(/\/$/, '')}/chat/completions`;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const TEXT_MODEL = process.env.NVIDIA_TEXT_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';
const TEXT_FALLBACK_MODEL = process.env.NVIDIA_TEXT_FALLBACK_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';
const VISION_MODEL = 'meta/llama-3.2-11b-vision-instruct';
const TEXT_TIMEOUT_MS = 120_000;

// Mercury 2.5 (Inception Labs) is the primary text model — Nemotron 3.5
// Lightning (NVIDIA) is the fallback for all scenario + import-equivalent
// text generation paths. Vision stays on NVIDIA.
const INCEPTION_BASE_URL = process.env.INCEPTION_BASE_URL || 'https://api.inceptionlabs.ai/v1';
const INCEPTION_API_URL = `${INCEPTION_BASE_URL.replace(/\/$/, '')}/chat/completions`;
const INCEPTION_API_KEY = process.env.INCEPTION_API_KEY;
const MERCURY_MODEL = process.env.INCEPTION_TEXT_MODEL || 'mercury-2.5';
const MERCURY_REASONING_EFFORT = process.env.INCEPTION_REASONING_EFFORT || 'low';
// minimaxai/minimax-m3 reached end-of-life on 2026-09-09 (NVIDIA returns 410
// Gone), and llama-90b-vision hangs past 60s - so the 11b Llama vision model
// is currently the only usable vision model on this endpoint.
const VISION_MODELS = ['meta/llama-3.2-11b-vision-instruct'];

function cleanTopic(raw: string): string {
  let t = raw.trim();
  // Strip common instruction prefixes that cause echoing
  const prefixes = [
    /^i want you to generate (the )?(context|content|post|caption) (for )?(the )?/i,
    /^please generate (the )?(context|content|post|caption) (for )?(the )?/i,
    /^generate (the )?(context|content|post|caption) (for )?(the )?/i,
    /^create (a )?(post|caption|content) (for )?(the )?/i,
    /^write (a )?(post|caption|content) (about|for) (the )?/i,
  ];
  for (const re of prefixes) t = t.replace(re, '').trim();
  // Remove trailing instruction about sexy girl — rewrite to professional
  t = t.replace(/add a sexy girl.*$/i, '').trim().replace(/\s+$/,'');
  // Cap length to keep relevance
  if (t.length > 500) t = t.substring(0, 500).trim();
  return t || raw;
}

function getToneDirective(tone: string): string {
  const map: Record<string, string> = {
    'Professional': 'TONE=Professional: ONLY professional words. Formal, polished, executive voice. Complete sentences, industry vocabulary, no slang, ZERO emojis, no exclamation overload. Example: "We are proud to unveil our latest innovation, a testament to engineering excellence."',
    'Casual': 'TONE=Casual: Be casual and ADD MORE EMOJIS (3-5 emojis). Friendly, conversational, warm, use contractions (we\'re, you\'ll), second person, short punchy sentences. Example: "So excited to share this! 🎉✨ Can\'t wait for you to see what we\'ve built 😍🚀"',
    'Inspirational': 'TONE=Inspirational: Content MUST have inspiration. Motivational, uplifting, visionary storytelling. Include an inspiring message, dream-big call, journey/future theme, emotional hook. Example: "This is more than a launch — it\'s a reminder that bold dreams drive us forward..."',
    'Educational': 'TONE=Educational: ALWAYS include a clear LESSON / takeaway. Informative, how-to, value-driven. Use structure, insights, "Lesson:", "Key takeaway:", practical learning. Example: "Lesson: A 5-point launch structure — Grand Reveal, Key Features, Live Demo, Social Moment, Automation — ensures every detail delivers value. Here\'s how..."',
  };
  return map[tone] || map['Professional'];
}

function buildSystemPrompt(platforms: string[], tone: string, hasImage: boolean, topic: string): string {
  const clean = cleanTopic(topic);
  const imageNote = hasImage
    ? 'Image uploaded: describe what you see in 2-3 sentences, then weave that description naturally into the caption. Do not ignore the image.'
    : '';
  const topicKeywords = clean.split(/\s+/).filter(w => w.length > 3).slice(0, 7).join(', ');
  const toneDirective = getToneDirective(tone);
  return `You are an expert LinkedIn copywriter. Output ONLY a valid JSON object. No markdown, no preamble, no explanation.
TONE LOCK: User selected [${tone}] — you MUST obey this tone 100% for the entire caption. Deviation will be rejected. ${toneDirective}

ABSOLUTE RULES — VIOLATION = REJECTED:
1. NEVER start caption with "I want you to generate" or repeat the user's instruction verbatim. Transform the request into a final polished post.
2. Caption MUST be a rewritten, professional post (100-150 words) ABOUT the subject: "${clean}" — not a copy of the instruction.
3. The subject's core is: "${clean.substring(0, 220)}". Focus ONLY on that event/topic. Do not write generic productivity advice unless the subject is productivity.
4. Professional, inclusive language only. If request contained sexualized language ("sexy girl"), rewrite to "professional host / presenter unboxing" — no sexualization.
5. Mention the key terms (${topicKeywords || clean}) naturally within the caption, not as a copied instruction.
6. Tone: ${tone} (Professional=formal, Casual=conversational, Inspirational=motivational, Educational=how-to). Keep tone strictly.

Topic (cleaned): "${clean}"
Original Topic: "${topic}"
Platforms: ${platforms.join(', ')}
Tone: ${tone}
${imageNote ? 'Image: ' + imageNote : ''}
Hashtags: 8-12, specific to "${clean}", mix broad+niche, no duplicates, plain words WITHOUT "#". No generic #viral unless relevant.

JSON exactly:
{
  "platforms": {
    "${platforms[0] || 'linkedin'}": { "caption": "100-150 words, polished post about \\"${clean}\\", ${tone} tone, zero echo of instruction", "hashtags": ["tag1","tag2",...] },
    ${platforms.slice(1).map(p=>`"${p}": { "caption": "...", "hashtags": [...] }`).join(',\n    ')}
  },
  "image_prompt": "photorealistic, high detail, professional scene about \\"${clean}\\", no sexualization, 4K"
}
Example caption start (do NOT copy prompt): "Thrilled to unveil our latest innovation..." / "The future of mobility is here..."

Write original content now.`;
}

interface PlatformContent {
  caption: string;
  hashtags: string[];
}

interface GeneratedContent {
  platforms: Record<string, PlatformContent>;
  image_prompt: string;
}

function validateStructure(data: unknown): data is GeneratedContent {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if (!obj.platforms || typeof obj.platforms !== 'object') return false;
  if (!obj.image_prompt || typeof obj.image_prompt !== 'string') return false;

  const platforms = obj.platforms as Record<string, unknown>;
  for (const key of Object.keys(platforms)) {
    const p = platforms[key] as Record<string, unknown>;
    if (!p.caption || typeof p.caption !== 'string') return false;
    if (!Array.isArray(p.hashtags)) return false;
  }
  return true;
}

function extractJSON(text: string): string | null {
  // Find ALL JSON objects that contain "platforms"
  const matches: string[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const candidate = text.substring(start, i + 1);
        if (candidate.includes('"platforms"')) {
          matches.push(candidate);
        }
        start = -1;
      }
    }
  }

  // Return the LAST valid match (Nemotron often puts clean JSON at the end)
  if (matches.length > 0) {
    return matches[matches.length - 1];
  }
  return null;
}


async function callMercury(prompt: string, systemPrompt: string, timeoutMs = TEXT_TIMEOUT_MS, model = MERCURY_MODEL): Promise<string> {
  // Test hook: prompts containing __FORCE_MERCURY_FAIL__ simulate a Mercury
  // outage so the Nemotron fallback path can be exercised live without
  // touching env vars.
  if (prompt.includes('__FORCE_MERCURY_FAIL__')) {
    console.warn(`[Mercury:${model}] forced failure for fallback test (prompt contained __FORCE_MERCURY_FAIL__)`);
    throw new Error('Mercury API error: 503 (forced fallback test)');
  }
  if (!INCEPTION_API_KEY) throw new Error('Inception API key not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(INCEPTION_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${INCEPTION_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        reasoning_effort: MERCURY_REASONING_EFFORT,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: 900,
        temperature: 0.6,
        top_p: 0.9,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Mercury:${model}] API error:`, response.status, errorText.slice(0, 500));
      throw new Error(`Mercury API error: ${response.status}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    console.log(`[Mercury:${model}] content: ${content.length} chars in <${timeoutMs}ms`);
    return content.trim();
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === 'AbortError') throw new Error(`Mercury API timeout (${Math.round(timeoutMs / 1000)}s) — please retry`);
    throw err;
  }
}

async function callNVIDIA(prompt: string, systemPrompt: string, timeoutMs = TEXT_TIMEOUT_MS, model = TEXT_MODEL): Promise<string> {
  if (!NVIDIA_API_KEY) throw new Error('NVIDIA API key not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(NVIDIA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        chat_template_kwargs: { thinking: false },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: 900,
        temperature: 0.6,
        top_p: 0.9,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[NVIDIA:${model}] API error:`, response.status, errorText.slice(0, 400));
      throw new Error(`NVIDIA API error: ${response.status}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    console.log(`[NVIDIA:${model}] content: ${content.length} chars in <${timeoutMs}ms`);
    return content.trim();
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === 'AbortError') throw new Error(`NVIDIA API timeout (${Math.round(timeoutMs / 1000)}s) — please retry`);
    throw err;
  }
}

async function callVisionWithImage(imageData: string | string[], systemPrompt: string, userPrompt: string, timeoutMs = 90000, model = VISION_MODEL): Promise<string> {
  if (!NVIDIA_API_KEY) throw new Error('NVIDIA API key not configured');
  const list = (Array.isArray(imageData) ? imageData : [imageData]).slice(0, 4);
  const toDataUrl = (d: string) => d.startsWith('data:') ? d : `data:image/jpeg;base64,${d}`;
  console.log(`[Vision+Text] Calling ${model} with ${list.length} image(s) (timeout ${timeoutMs}ms)`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(NVIDIA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: [...list.map(u => ({ type: 'image_url', image_url: { url: toDataUrl(u) } })), { type: 'text', text: list.length > 1 ? `[${list.length} reference images attached — consider ALL of them] ${userPrompt}` : userPrompt }] },
        ],
        max_tokens: 2000,
        temperature: 0.55,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Vision+Text:${model}] API error:`, response.status, errorText.slice(0, 400));
      // Surface 5xx distinctly so callers can retry transient failures.
      if (response.status >= 500) throw new Error(`Vision API error (${model}): ${response.status} (transient)`);
      throw new Error(`Vision API error (${model}): ${response.status}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    console.log(`[Vision+Text] Success, ${content.length} chars`);
    return content;
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === 'AbortError') throw new Error(`Vision API timeout (${Math.round(timeoutMs / 1000)}s)`);
    throw err;
  }
}

// Large/raw uploads (e.g. full-res PNG screenshots) make NVIDIA vision return
// HTTP 500, and even tiny PNGs are very slow (60s+). Normalize everything to
// a bounded JPEG before any vision call: small JPEGs pass through untouched,
// anything else is resized inside 1024px at q70 (proven: 16KB JPEG -> 4.5s OK).
async function normalizeImageForVision(input: string): Promise<string> {
  const raw = input.includes(',') ? (input.split(',').pop() as string) : input;
  const buf = Buffer.from(raw, 'base64');
  const isSmallJpeg = buf.length < 100_000 && buf[0] === 0xff && buf[1] === 0xd8;
  if (isSmallJpeg) return input.startsWith('data:') ? input : `data:image/jpeg;base64,${raw}`;
  try {
    const { default: sharp } = await import('sharp');
    const out = await sharp(buf).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
    console.log(`[Vision] normalized ${Math.round(buf.length / 1024)}KB -> ${Math.round(out.length / 1024)}KB JPEG`);
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch (err) {
    console.log(`[Vision] normalize failed (${(err as Error).message}), sending original`);
    return input.startsWith('data:') ? input : `data:image/jpeg;base64,${raw}`;
  }
}

// Retry helper: vision calls are slow/flaky — retry timeouts & 5xx once
async function withVisionRetry<T>(label: string, fn: () => Promise<T>, retries = 1): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const retryable = /timeout|429|5\d\d|fetch failed|ECONNRESET/i.test(msg);
    if (retries > 0 && retryable) {
      console.log(`[${label}] retryable failure (${msg}), retrying once after 3s…`);
      await new Promise(r => setTimeout(r, 3000));
      return await fn();
    }
    throw err;
  }
}

async function analyzeImageSeparately(imageData: string | string[], timeoutMs = 60000, model = VISION_MODEL): Promise<string> {
  if (!NVIDIA_API_KEY) throw new Error('NVIDIA API key not configured');
  const list = (Array.isArray(imageData) ? imageData : [imageData]).slice(0, 4);
  const toDataUrl = (d: string) => d.startsWith('data:') ? d : `data:image/jpeg;base64,${d}`;
  console.log(`[Vision] Analyzing ${list.length} image(s) separately with ${model} (timeout ${timeoutMs}ms)`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(NVIDIA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: [...list.map((u, i) => ({ type: 'image_url', image_url: { url: toDataUrl(u) } })), { type: 'text', text: list.length > 1 ? `Describe EACH of these ${list.length} images in 1-2 sentences (label them Image 1, Image 2...) covering subject, setting, objects, colors, mood — for a LinkedIn caption. Be specific.` : 'Describe this image in detail (subject, setting, objects, colors, mood) in 2-3 sentences for a LinkedIn caption. Be specific.' }] }],
        max_tokens: 350 + list.length * 150,
        temperature: 0.45,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`Vision API error: ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    console.log(`[Vision] Analysis: ${content.length} chars`);
    return content;
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === 'AbortError') throw new Error(`Vision analysis timeout (${Math.round(timeoutMs / 1000)}s)`);
    throw err;
  }
}

// Resolves with the first task that yields a non-null value, or null once
// every task has settled without one. Losers keep running to completion in
// the background (their results are discarded) - the race is about latency,
// not about cancelling the slower model.
function raceToFirst<T>(tasks: Array<() => Promise<T | null>>): Promise<T | null> {
  return new Promise((resolve) => {
    let pending = tasks.length;
    let won = false;
    if (pending === 0) { resolve(null); return; }
    for (const run of tasks) {
      run().then(out => {
        if (out && !won) { won = true; resolve(out); return; }
        pending--;
        if (pending === 0 && !won) resolve(null);
      });
    }
  });
}

async function generateContent(prompt: string, platforms: string[], tone: string, hasImage: boolean, imageData?: string, imageDataList?: string[]): Promise<GeneratedContent> {
  const systemPrompt = buildSystemPrompt(platforms, tone, hasImage, prompt || 'general social media post');

  // IMAGE PATH: vision model chain (minimax → llama fallback), then two-step.
  // Supports up to 4 reference images in a single multimodal call.
  if (hasImage && (imageDataList?.length || imageData)) {
    const rawImgs = (Array.isArray(imageDataList) && imageDataList.length ? imageDataList : [imageData as string]).slice(0, 4);
    // Normalize (downscale -> JPEG) so NVIDIA vision doesn't 500 on huge PNGs.
    const imgs = await Promise.all(rawImgs.map(normalizeImageForVision));
    const imgLabel = imgs.length > 1 ? `${imgs.length} images` : 'image';
    const directPrompt = prompt
      ? `Generate a social media post about: "${prompt}", using ALL ${imgLabel} attached as visual reference. Return JSON with platforms and image_prompt.`
      : `Look at ALL ${imgLabel} attached and generate a social media post about them. Return JSON with platforms and image_prompt.`;

    // Attempt 1: race every vision model in parallel - each gets ALL images
    // in a single multimodal call (60s each), fastest valid JSON wins.
    const raceDirect = (model: string) => async () => {
      try {
        const raw = await callVisionWithImage(imgs, systemPrompt, directPrompt, 60000, model);
        const result = parseAndValidate(raw);
        if (result) {
          console.log(`[Image] race winner: ${model}`);
          return { model, result };
        }
        console.log(`[Image] ${model} returned unparseable output, out of the race`);
      } catch (err) {
        console.log(`[Image] ${model} direct failed: ${err}`);
      }
      return null;
    };
    const winner = await raceToFirst(VISION_MODELS.map(raceDirect));
    if (winner) return winner.result;

    // Attempt 2: analyze images separately with each model (45s each), then
    // Mercury primary → Nemotron fallback for the text step (same as Scenario 1).
    // Analysis calls are wrapped in withVisionRetry — NVIDIA vision 5xx's
    // transiently even on normalized images, and one retry usually succeeds.
    for (const model of VISION_MODELS) {
      try {
        const analysis = await withVisionRetry(`Two-step/${model}`, () => analyzeImageSeparately(imgs, 45000, model));
        if (analysis) {
          const desc = analysis.replace(/["\\\n\r\t]/g, ' ').substring(0, 900).trim();
          const userPrompt = prompt
            ? `Topic: ${prompt}\n\nImage analysis (${imgs.length} image${imgs.length === 1 ? '' : 's'}): ${desc}`
            : `Create a social media post based on these images: ${desc}`;
          // Mercury primary for the caption step
          try {
            const raw = await callMercury(userPrompt, systemPrompt, TEXT_TIMEOUT_MS, MERCURY_MODEL);
            const result = parseAndValidate(raw);
            if (result) return result;
            console.log(`[Image] Two-step Mercury via ${model}: first draft unparseable, trying Nemotron fallback…`);
          } catch (e) {
            const msg = (e as Error).message;
            console.log(`[Image] Two-step Mercury via ${model} failed: ${msg}`);
            if (/timeout/i.test(msg)) throw e;
          }
          const raw = await callNVIDIA(userPrompt, systemPrompt, TEXT_TIMEOUT_MS, TEXT_MODEL);
          const result = parseAndValidate(raw);
          if (result) return result;
          // One strict retry: unparseable first drafts are common, and a
          // JSON-only nudge usually fixes them. Try Mercury strict first, then Nemotron strict.
          console.log(`[Image] Two-step via ${model}: first draft unparseable, strict retry…`);
          const strictSystem = systemPrompt + '\n\nSTRICT JSON ONLY: Respond with just the JSON object starting with { and ending with }. No explanation, no markdown, no line breaks inside strings.';
          try {
            const rawStrictMercury = await callMercury(userPrompt, strictSystem, TEXT_TIMEOUT_MS, MERCURY_MODEL);
            const resultStrictMercury = parseAndValidate(rawStrictMercury);
            if (resultStrictMercury) return resultStrictMercury;
          } catch (e) {
            console.log(`[Image] Two-step Mercury strict via ${model} failed: ${(e as Error).message}`);
          }
          const rawStrict = await callNVIDIA(userPrompt, strictSystem, TEXT_TIMEOUT_MS, TEXT_FALLBACK_MODEL !== TEXT_MODEL ? TEXT_FALLBACK_MODEL : TEXT_MODEL);
          const resultStrict = parseAndValidate(rawStrict);
          if (resultStrict) return resultStrict;
        }
      } catch (err) {
        console.log(`[Image] Two-step via ${model} failed: ${err}`);
      }
    }

    throw new Error('Vision models are slow right now — please retry, or generate without an image.');
  }

  // TEXT-ONLY PATH (Scenario 1 + import-equivalent): Mercury 2.5
  // (Inception Labs, diffusion, reasoning_effort low) is primary —
  // Nemotron 3.5 Lightning (NVIDIA, nvidia/nemotron-3.5-lightning-30b-a3b)
  // is the fallback for every scenario/import. Vision stays NVIDIA-only.
  // Mercury is diffusion-parallel and typically 2–5s; Nemotron is slower
  // (12–70s) and kept strictly as the fallback.
  const cleanedPrompt = cleanTopic(prompt) || 'Create a social media post';
  const userPrompt = `Write the post about: "${cleanedPrompt}". Transform the request into a final post — do NOT echo the instruction. Topic tone: ${tone}.`;
  // 1) Mercury primary
  try {
    const raw = await callMercury(userPrompt, systemPrompt, TEXT_TIMEOUT_MS, MERCURY_MODEL);
    const result = parseAndValidate(raw);
    if (result) return result;
    console.log(`[Text:${MERCURY_MODEL}] first call unparseable, trying Nemotron fallback…`);
  } catch (e) {
    const message = (e as Error).message;
    console.log(`[Text:${MERCURY_MODEL}] first call failed:`, message);
    // Keep public Cloudflare requests inside one 120s window. Retrying
    // after a timeout pushes the response past Cloudflare's budget and
    // turns a useful app error into a 524 at the browser.
    if (/timeout/i.test(message)) throw e;
  }
  // 2) Nemotron fallback
  try {
    const raw = await callNVIDIA(userPrompt, systemPrompt, TEXT_TIMEOUT_MS, TEXT_MODEL);
    const result = parseAndValidate(raw);
    if (result) return result;
  } catch (e) {
    const message = (e as Error).message;
    console.log(`[Text:${TEXT_MODEL}] fallback call failed:`, message);
    if (/timeout/i.test(message)) throw e;
  }
  // 3) Strict retry — Mercury strict first, then Nemotron strict
  const retrySystem = systemPrompt + '\n\nSTRICT JSON ONLY: Respond with just the JSON object starting with { and ending with }. No explanation. Do NOT start caption with "I want you to generate".';
  try {
    const rawStrictMercury = await callMercury(userPrompt, retrySystem, TEXT_TIMEOUT_MS, MERCURY_MODEL);
    const resultStrictMercury = parseAndValidate(rawStrictMercury);
    if (resultStrictMercury) return resultStrictMercury;
    console.log(`[Text:${MERCURY_MODEL}] strict retry unparseable, trying Nemotron strict…`);
  } catch (e) {
    console.log(`[Text:${MERCURY_MODEL}] strict retry failed: ${(e as Error).message}`);
  }
  const raw2 = await callNVIDIA(userPrompt, retrySystem, TEXT_TIMEOUT_MS, TEXT_FALLBACK_MODEL !== TEXT_MODEL ? TEXT_FALLBACK_MODEL : TEXT_MODEL);
  const result2 = parseAndValidate(raw2);
  if (result2) return result2;
  throw new Error('AI is echoing the prompt — please rewrite your topic more concisely (e.g., "Car launch event with Grand Reveal, Key Features, Live Launch...") and try again.');
}

function repairHashtags(jsonStr: string): string {
  return jsonStr.replace(/("hashtags"\s*:\s*\[)([^\]]*)(\])/g, (_m, open: string, inner: string, close: string) => {
    const items = inner.split(',').map(t => {
      const tok = t.trim();
      if (!tok || tok.startsWith('"')) return tok;
      return `"${tok}"`;
    });
    return `${open}${items.join(',')}${close}`;
  });
}

// Last-resort extractor for model output that is almost-JSON but has
// unescaped quotes inside caption/hashtag strings (JSON.parse can't handle
// those, no matter how we pre-sanitize). Anchors on the known shape
// "caption" ... "hashtags" [...] / "image_prompt" and cleans each piece.
function tolerantParse(raw: string): Record<string, unknown> | null {
  const platMatch = raw.match(/"platforms"\s*:\s*{\s*"(\w+)"/);
  const platName = platMatch?.[1] || 'linkedin';
  const capMatch = raw.match(/"caption"\s*:\s*"([\s\S]*?)"\s*,\s*"hashtags"/);
  if (!capMatch) return null;
  const caption = capMatch[1].replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (caption.length < 80) return null;
  const tagsMatch = raw.match(/"hashtags"\s*:\s*\[([\s\S]*?)\]/);
  const hashtags: string[] = [];
  if (tagsMatch) {
    for (const tok of tagsMatch[1].split(',')) {
      const t = tok.trim().replace(/^["'#\s]+|["'\s]+$/g, '').replace(/\s+/g, '');
      if (t && !/[{}\[\]":]/.test(t)) hashtags.push(t);
    }
  }
  const ipMatch = raw.match(/"image_prompt"\s*:\s*"([\s\S]*?)"\s*[},]/);
  const imagePrompt = ipMatch?.[1].replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim() || 'professional social media photo';
  return { platforms: { [platName]: { caption, hashtags } }, image_prompt: imagePrompt };
}

function parseAndValidate(raw: string): GeneratedContent | null {
  let jsonString = extractJSON(raw);
  console.log(`[JSON] Extracted: ${jsonString?.substring(0, 300) || 'null'}`);
  if (!jsonString) return null;

  // Models often emit literal newlines/tabs inside caption strings, which is
  // invalid JSON. Collapse C0 controls to spaces before parsing.
  jsonString = jsonString.replace(/[\u0000-\u001F]+/g, ' ');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    // Retry with repaired hashtags (model sometimes emits unquoted #tags)
    try {
      parsed = JSON.parse(repairHashtags(jsonString));
      console.log('[JSON] Parsed after hashtag repair');
    } catch (e2) {
      // Final fallback: tolerant regex extraction for unescaped quotes.
      const rescued = tolerantParse(raw);
      if (rescued) {
        console.log('[JSON] Rescued via tolerant parse');
        parsed = rescued;
      } else {
        console.log(`[JSON] Parse error: ${e2}`);
        return null;
      }
    }
  }

  // Normalize flat structures (caption at top level, platforms as string)
  const p = parsed as { platforms?: unknown; caption?: string; hashtags?: unknown; image_prompt?: string };
  if (p.caption && (!p.platforms || typeof p.platforms !== 'object' || Array.isArray(p.platforms))) {
    const platName = typeof p.platforms === 'string' ? p.platforms : 'linkedin';
    const tags = Array.isArray(p.hashtags) ? p.hashtags : (p.hashtags ? [p.hashtags] : []);
    parsed = {
      platforms: { [platName]: { caption: p.caption, hashtags: tags } },
      image_prompt: p.image_prompt || '',
    };
    console.log(`[JSON] Normalized flat structure -> ${platName}`);
  }

  console.log(`[JSON] Parsed, platforms: ${JSON.stringify(Object.keys((parsed as { platforms?: object }).platforms || {}))}`);

  // Reject echo / instruction copy and placeholder
  const caption = (parsed as { platforms?: { linkedin?: { caption?: string } } })?.platforms?.linkedin?.caption || Object.values((parsed as { platforms?: Record<string, {caption?:string}> }).platforms || {})[0]?.caption || '';
  const lowerCap = caption.toLowerCase();
  if (lowerCap.startsWith('i want you to generate') || lowerCap.includes('i want you to generate the context for')) {
    console.log('[JSON] Rejected: echo of instruction');
    return null;
  }
  if (caption.includes('your content') || caption.includes('hashtag') || caption.length < 80) {
    console.log('[JSON] Rejected: placeholder or too short');
    return null;
  }

  if (!validateStructure(parsed as unknown as GeneratedContent)) {
    console.log('[JSON] Validation failed');
    return null;
  }

  const result = parsed as unknown as GeneratedContent;
  for (const key of Object.keys(result.platforms)) {
    result.platforms[key].hashtags = sanitizeHashtags(result.platforms[key].hashtags);
  }
  return result;
}

// Strip any leading "#" the model added anyway (it's re-added on the client),
// trim whitespace, drop empties, and dedupe case-insensitively.
function sanitizeHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of tags) {
    const tag = String(raw).replace(/^#+/, '').trim().replace(/\s+/g, '');
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(tag);
  }
  return cleaned;
}

export async function POST(request: NextRequest) {
  try {
    const { prompt, tone, platforms, hasImage, imageData, imageDataList } = await request.json();

    if (!prompt?.trim() && !hasImage) {
      return NextResponse.json({ error: 'Topic or image is required' }, { status: 400 });
    }

    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return NextResponse.json({ error: 'At least one platform must be selected' }, { status: 400 });
    }

    const validPlatforms = ['linkedin', 'instagram', 'facebook', 'whatsapp'];
    const selectedPlatforms = platforms.filter((p: string) => validPlatforms.includes(p));

    if (selectedPlatforms.length === 0) {
      return NextResponse.json({ error: 'No valid platforms selected' }, { status: 400 });
    }

    const result = await generateContent(prompt.trim(), selectedPlatforms, tone || 'professional', !!hasImage, imageData, Array.isArray(imageDataList) ? imageDataList : undefined);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error generating content:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate content' },
      { status: 500 }
    );
  }
}
