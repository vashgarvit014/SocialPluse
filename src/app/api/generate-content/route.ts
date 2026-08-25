import { NextRequest, NextResponse } from 'next/server';

const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const TEXT_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
const VISION_MODEL = 'minimaxai/minimax-m3';

function buildSystemPrompt(platforms: string[], tone: string, hasImage: boolean, topic: string): string {
  const imageNote = hasImage
    ? 'The user uploaded an image. Look at it and generate content about what you see.'
    : '';

  return `You are a social media content writer. Output ONLY a JSON object. No text before or after.

Topic: "${topic}"
Platforms: ${platforms.join(', ')}
Tone: ${tone}
${imageNote ? 'Image: ' + imageNote : ''}

Write a detailed caption (100-150 words) specifically about "${topic}". Use exactly ONE hashtag.

The JSON must nest content under the platform name: top-level keys are "platforms" and "image_prompt". Inside "platforms", use each platform name as a key, and inside that put "caption" (string) and "hashtags" (array with exactly one item). Write original content about the topic.`;
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


async function callNVIDIA(prompt: string, systemPrompt: string): Promise<string> {
  if (!NVIDIA_API_KEY) {
    throw new Error('NVIDIA API key not configured');
  }

  const response = await fetch(NVIDIA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      chat_template_kwargs: { thinking: false },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1500,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Nemotron] API error:', response.status, errorText);
    throw new Error(`NVIDIA API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  console.log(`[Nemotron] content: ${content.length} chars`);
  return content.trim();
}

async function callVisionWithImage(imageData: string, systemPrompt: string, userPrompt: string): Promise<string> {
  if (!NVIDIA_API_KEY) {
    throw new Error('NVIDIA API key not configured');
  }

  const dataUrl = imageData.startsWith('data:') ? imageData : `data:image/jpeg;base64,${imageData}`;

  console.log(`[Vision+Text] Calling ${VISION_MODEL} with image`);

  const response = await fetch(NVIDIA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: userPrompt },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Vision+Text] API error:', response.status, errorText);
    throw new Error(`Vision API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  console.log(`[Vision+Text] Success, ${content.length} chars`);
  return content;
}

async function analyzeImageSeparately(imageData: string): Promise<string> {
  if (!NVIDIA_API_KEY) throw new Error('NVIDIA API key not configured');

  const dataUrl = imageData.startsWith('data:') ? imageData : `data:image/jpeg;base64,${imageData}`;
  console.log(`[Vision] Analyzing image separately`);

  const response = await fetch(NVIDIA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: 'Describe this image in detail for social media content. Include: subject, setting, objects, text visible, colors, mood, and story. Be specific.' },
        ],
      }],
      max_tokens: 800,
      temperature: 0.5,
    }),
  });

  if (!response.ok) throw new Error(`Vision API error: ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  console.log(`[Vision] Analysis: ${content.length} chars`);
  return content;
}

async function generateContent(prompt: string, platforms: string[], tone: string, hasImage: boolean, imageData?: string): Promise<GeneratedContent> {
  const systemPrompt = buildSystemPrompt(platforms, tone, hasImage, prompt || 'general social media post');

  // IMAGE PATH: try vision model first, fallback to two-step
  if (hasImage && imageData) {
    // Attempt 1: vision model sees image + generates JSON in one call
    try {
      const userPrompt = prompt
        ? `Generate a social media post about: "${prompt}". Return JSON with platforms and image_prompt.`
        : `Look at this image and generate a social media post about it. Return JSON with platforms and image_prompt.`;
      const raw = await callVisionWithImage(imageData, systemPrompt, userPrompt);
      const result = parseAndValidate(raw);
      if (result) return result;
    } catch (err) {
      console.log(`[Image] Vision model failed, trying two-step: ${err}`);
    }

    // Attempt 2: analyze image separately, then generate content with text model
    try {
      const analysis = await analyzeImageSeparately(imageData);
      if (analysis) {
        const desc = analysis.replace(/["\\\n\r\t]/g, ' ').substring(0, 600).trim();
        const userPrompt = prompt
          ? `Topic: ${prompt}\n\nImage analysis: ${desc}`
          : `Create a social media post based on this image: ${desc}`;
        const raw = await callNVIDIA(userPrompt, systemPrompt);
        const result = parseAndValidate(raw);
        if (result) return result;
      }
    } catch (err) {
      console.log(`[Image] Two-step also failed: ${err}`);
    }

    throw new Error('Failed to generate content from image. Please try again or generate without an image.');
  }

  // TEXT-ONLY PATH: use Nemotron
  const raw = await callNVIDIA(prompt || 'Create a social media post', systemPrompt);
  const result = parseAndValidate(raw);
  if (result) return result;

  // Retry
  const retrySystem = systemPrompt + '\n\nCRITICAL: Output ONLY the raw JSON object. No text before or after. No markdown. Just { ... }';
  const raw2 = await callNVIDIA(prompt || 'Create a social media post', retrySystem);
  const result2 = parseAndValidate(raw2);
  if (result2) return result2;

  throw new Error('AI returned invalid content structure. Please try again.');
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

function parseAndValidate(raw: string): GeneratedContent | null {
  let jsonString = extractJSON(raw);
  console.log(`[JSON] Extracted: ${jsonString?.substring(0, 300) || 'null'}`);
  if (!jsonString) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    // Retry with repaired hashtags (model sometimes emits unquoted #tags)
    try {
      parsed = JSON.parse(repairHashtags(jsonString));
      console.log('[JSON] Parsed after hashtag repair');
    } catch (e2) {
      console.log(`[JSON] Parse error: ${e2}`);
      return null;
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

  // Check for placeholder text
  const caption = (parsed as { platforms?: { linkedin?: { caption?: string } } })?.platforms?.linkedin?.caption || '';
  if (caption.includes('your content') || caption.includes('hashtag') || caption.length < 50) {
    console.log('[JSON] Rejected: placeholder or too short');
    return null;
  }

  if (validateStructure(parsed as unknown as GeneratedContent)) return parsed as unknown as GeneratedContent;
  console.log('[JSON] Validation failed');
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const { prompt, tone, platforms, hasImage, imageData } = await request.json();

    if (!prompt?.trim() && !hasImage) {
      return NextResponse.json({ error: 'Topic or image is required' }, { status: 400 });
    }

    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return NextResponse.json({ error: 'At least one platform must be selected' }, { status: 400 });
    }

    const validPlatforms = ['linkedin', 'instagram', 'facebook', 'twitter'];
    const selectedPlatforms = platforms.filter((p: string) => validPlatforms.includes(p));

    if (selectedPlatforms.length === 0) {
      return NextResponse.json({ error: 'No valid platforms selected' }, { status: 400 });
    }

    const result = await generateContent(prompt.trim(), selectedPlatforms, tone || 'professional', !!hasImage, imageData);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error generating content:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate content' },
      { status: 500 }
    );
  }
}