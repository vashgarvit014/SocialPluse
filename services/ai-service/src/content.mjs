// Faithful port of src/app/api/generate-content/route.ts's generation core
// (everything except the HTTP handler itself, which lives in server.mjs).
// Every prompt template, provider fallback chain, and parsing heuristic
// preserved verbatim — this is tuned product behavior, not something to
// improve in translation.

const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const NVIDIA_API_URL = `${NVIDIA_BASE_URL.replace(/\/$/, '')}/chat/completions`;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const TEXT_MODEL = process.env.NVIDIA_TEXT_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';
const TEXT_FALLBACK_MODEL = process.env.NVIDIA_TEXT_FALLBACK_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';
const VISION_MODEL = 'meta/llama-3.2-11b-vision-instruct';
const TEXT_TIMEOUT_MS = 120_000;

const INCEPTION_BASE_URL = process.env.INCEPTION_BASE_URL || 'https://api.inceptionlabs.ai/v1';
const INCEPTION_API_URL = `${INCEPTION_BASE_URL.replace(/\/$/, '')}/chat/completions`;
const INCEPTION_API_KEY = process.env.INCEPTION_API_KEY;
const MERCURY_MODEL = process.env.INCEPTION_TEXT_MODEL || 'mercury-2.5';
const MERCURY_REASONING_EFFORT = process.env.INCEPTION_REASONING_EFFORT || 'low';
const VISION_MODELS = ['meta/llama-3.2-11b-vision-instruct'];

function cleanTopic(raw) {
  let t = raw.trim();
  const prefixes = [
    /^i want you to generate (the )?(context|content|post|caption) (for )?(the )?/i,
    /^please generate (the )?(context|content|post|caption) (for )?(the )?/i,
    /^generate (the )?(context|content|post|caption) (for )?(the )?/i,
    /^create (a )?(post|caption|content) (for )?(the )?/i,
    /^write (a )?(post|caption|content) (about|for) (the )?/i,
  ];
  for (const re of prefixes) t = t.replace(re, '').trim();
  t = t.replace(/add a sexy girl.*$/i, '').trim().replace(/\s+$/, '');
  if (t.length > 500) t = t.substring(0, 500).trim();
  return t || raw;
}

function getToneDirective(tone) {
  const map = {
    'Professional': 'TONE=Professional: ONLY professional words. STRUCTURE IS MANDATORY — write in PARAGRAPH form: 2-4 flowing paragraphs of complete sentences (opening, context/detail, takeaway). NO bullet or numbered lists as the body (LinkedIn alone may add at most 3 short • points AFTER its paragraphs). Formal, polished, executive voice, industry vocabulary, no slang, ZERO emojis, no exclamation overload. Example: "We are proud to unveil our latest innovation, a testament to engineering excellence. The new lineup reflects months of focused research into what professionals need most..."',
    'Casual': 'TONE=Casual: STRUCTURE IS MANDATORY — short, punchy, conversational flow: 1-3 very short paragraphs or single-line bursts with generous line breaks, NEVER long formal paragraphs. Friendly, warm, contractions (we\'re, you\'ll), second person, ADD MORE EMOJIS (3-5 emojis). Example: "So excited to share this! 🎉✨ Can\'t wait for you to see what we\'ve built 😍🚀"',
    'Inspirational': 'TONE=Inspirational: STRUCTURE IS MANDATORY — emotive storytelling rhythm: short rhythmic lines and mini-paragraphs, an emotional hook first, a journey/struggle→perspective arc, and a dream-big call-to-action close. NEVER a dry corporate paragraph. Motivational, uplifting, visionary, emojis welcome (2-4). Example: "This is more than a launch — it\'s a reminder that bold dreams drive us forward..."',
    'Educational': 'TONE=Educational: STRUCTURE IS MANDATORY — teach in SCAFFOLDED form: a clear headline lesson first, then numbered or bulleted teaching points, then a "Key takeaway:" close. ALWAYS include a real lesson/takeaway, practical and value-driven. NEVER a formless paragraph. Example: "Lesson: A 5-point launch structure — Grand Reveal, Key Features, Live Demo, Social Moment, Automation — ensures every detail delivers value. Here\'s how..."',
  };
  return map[tone] || map['Professional'];
}

function inferCategory(topic) {
  const t = topic.toLowerCase();
  const has = (...words) => words.some((w) => t.includes(w));
  if (has('hiring', 'we are hiring', 'join our team', 'vacancy', 'vacancies', 'recruitment', 'career opportunity', 'we’re hiring', 'we are expanding our team')) return { name: 'Hiring / Recruitment', depth: 'standard', note: 'Role, team, why it matters, clear apply CTA. No invented salary/location unless given.' };
  if (has('how to', 'how-to', 'guide', 'tutorial', 'tips for', 'tips on', 'learn ', 'learning', 'explained', 'explainer', 'awareness', 'why ') && has('student', 'guide', 'learn', 'tips', 'awareness', 'how', 'why', 'explained')) return { name: 'Educational', depth: 'rich', note: 'Teach something real: explanation, structured points, clear takeaway.' };
  if (has('thought leadership', 'industry insight', 'perspective on', 'future of', 'trends', 'opinion:', 'what this means for the industry')) return { name: 'Thought Leadership', depth: 'rich', note: 'Professional context + genuine insight + perspective, not hype.' };
  if (has('believe in yourself', 'believe in', 'motivat', 'inspir', 'mindset', 'keep going', 'keep moving', 'dream', 'persever', 'never give up', 'you can do it')) return { name: 'Motivational', depth: 'rich', note: 'Emotional but grounded arc: struggle → perspective → encouragement → CTA.' };
  if (has('launch', 'unveil', 'introducing', 'introduce', 'new product', 'release', 'debut', 'grand opening', 'now live', 'now available')) return { name: 'Product Launch', depth: 'standard', note: 'Benefit-led: what it is, why it matters, who it helps, strong CTA.' };
  if (has('event', 'webinar', 'conference', 'meetup', 'workshop', 'join us', 'register', 'save the date', 'summit')) return { name: 'Event', depth: 'concise', note: 'What/when-CWhat-context (only given facts), who should attend, register CTA.' };
  if (has('announc', 'update', 'news:', 'big news', 'opening', 'now open')) return { name: 'Announcement', depth: 'concise', note: 'Concise clarity: what changed, why it matters, next step.' };
  if (has('award', 'milestone', 'achievement', 'congratulations', 'celebrat', 'anniversary', 'proud to share')) return { name: 'Celebration', depth: 'standard', note: 'Warm, specific about what was achieved, thank the people involved.' };
  if (has('sale', 'discount', 'offer', 'deal ', 'promo', 'save ', '% off', 'limited time', 'coupon')) return { name: 'Promotional', depth: 'standard', note: 'Benefit-led + urgency + CTA. Never invent prices/discounts not provided.' };
  if (has('community', 'members', 'group update', 'together', 'family')) return { name: 'Community Update', depth: 'standard', note: 'Warm, inclusive, direct address to members.' };
  if (has('brand', 'our story', 'mission', 'values', 'who we are')) return { name: 'Brand Awareness', depth: 'standard', note: 'Story-driven, values-forward, human voice.' };
  if (has('educat', 'lesson', 'takeaway', 'did you know', 'myth', 'fact check')) return { name: 'Educational', depth: 'rich', note: 'Teach something real: explanation, structured points, clear takeaway.' };
  return { name: 'General Update', depth: 'standard', note: 'Clear, useful, appropriately scoped to the facts given.' };
}

const PLATFORM_SPECS = {
  linkedin: {
    label: 'LinkedIn',
    instructions: `LinkedIn (professional feed, credible + insightful, authoritative but not stiff):
- Hook: strong professional opening line.
- Context: what happened / what is launching (ONLY user-supplied facts).
- Core insight or story, then 2-4 structured bullet points (use "•").
- Professional takeaway + discussion CTA (e.g. "What has been your experience?").
- LENGTH is driven by category depth (see CATEGORY note). Short announcements stay tight; educational/thought-leadership goes deep.
- Professional tone: ZERO emojis (the tone lock forbids them).`,
    hashtags: 'Hashtags: 3-6 highly relevant professional tags, plain words WITHOUT "#".',
    jsonField: `"linkedin": { "caption": "<LinkedIn post per spec above>", "hashtags": ["tag1","tag2",...] }`,
  },
  instagram: {
    label: 'Instagram',
    instructions: `Instagram (visual, punchy, scannable — NOT a LinkedIn article):
- 60-150 words. Strong emotional/visual hook FIRST line.
- 1-2 short engaging paragraphs, short sentences, generous line breaks.
- Selective relevant emojis (2-5) that fit the selected tone — Professional tone means NONE.
- Concise CTA (e.g. "Save this post and tell us your favourite feature.").
- Caption must complement a visual, not lecture.`,
    hashtags: 'Hashtags: 8-12 discoverability-oriented relevant tags, plain words WITHOUT "#".',
    jsonField: `"instagram": { "caption": "<Instagram caption per spec above>", "hashtags": ["tag1","tag2",...] }`,
  },
  facebook: {
    label: 'Facebook',
    instructions: `Facebook (conversational, warm, community-oriented — between LinkedIn and Instagram):
- 80-220 words. Friendly hook, short story/context, benefits or details.
- Community voice ("you", "we", "our community"), moderate emojis (1-4).
- Community-oriented CTA (e.g. "Tell us what you think in the comments.").
- May carry more explanatory context than Instagram; never a copy of it.`,
    hashtags: 'Hashtags: 0-5 only if genuinely relevant, plain words WITHOUT "#". Empty array is fine.',
    jsonField: `"facebook": { "caption": "<Facebook post per spec above>", "hashtags": ["tag1",...] }`,
  },
  whatsapp: {
    label: 'WhatsApp',
    instructions: `WhatsApp (direct community/announcement message — NOT a social caption):
- NO HASHTAGS anywhere in the caption. Empty hashtags array.
- WhatsApp-native formatting: *bold* headings, _italic_ sparingly, • or numbered lists, short paragraphs with blank lines.
- Structure: *bold headline*, 1-2 short intro paragraphs, *bold section heading(s)* + bullets, direct CTA (e.g. "Reply here if you'd like more details.").
- May be MORE detailed than Instagram where useful (direct communication), but never a corporate essay. Keep it readable on a phone screen.`,
    hashtags: 'Hashtags: NONE. Always return "hashtags": []. Never put #tags in the WhatsApp caption.',
    jsonField: `"whatsapp": { "caption": "<WhatsApp message per spec above, NO hashtags>", "hashtags": [] }`,
  },
};

function linkedinMinWords(topic) {
  const depth = inferCategory(cleanTopic(topic)).depth;
  return depth === 'rich' ? 180 : depth === 'concise' ? 60 : 100;
}
function linkedinWordCount(r) {
  const cap = r.platforms['linkedin']?.caption || '';
  return cap.split(/\s+/).filter(Boolean).length;
}

function buildSystemPrompt(platforms, tone, hasImage, topic) {
  const clean = cleanTopic(topic);
  const imageNote = hasImage ? 'Image uploaded: describe what you see in 2-3 sentences, then weave that description naturally into the caption. Do not ignore the image.' : '';
  const topicKeywords = clean.split(/\s+/).filter((w) => w.length > 3).slice(0, 7).join(', ');
  const toneDirective = getToneDirective(tone);
  const category = inferCategory(clean);
  const selected = platforms.filter((p) => PLATFORM_SPECS[p]);
  const platformSections = selected.map((p) => `--- ${PLATFORM_SPECS[p].label.toUpperCase()} ---\n${PLATFORM_SPECS[p].instructions}\n${PLATFORM_SPECS[p].hashtags}`).join('\n\n');
  const jsonFields = selected.map((p) => PLATFORM_SPECS[p].jsonField).join(',\n    ');
  const linkedinDepth = category.depth === 'rich'
    ? 'LinkedIn LENGTH: 180-400 words (this topic deserves depth — full context, examples, structured points, takeaway). MINIMUM 180 words — fewer will be rejected.'
    : category.depth === 'concise'
      ? 'LinkedIn LENGTH: 60-120 words (tight professional update, no padding). MINIMUM 60 words — fewer will be rejected.'
      : 'LinkedIn LENGTH: 100-200 words (focused professional update with real substance). MINIMUM 100 words — fewer will be rejected.';
  return `You are an expert social-media copywriter who writes natively for each platform. Output ONLY a valid JSON object. No markdown, no preamble, no explanation.
TONE LOCK: User selected [${tone}] — the tone's STRUCTURE is mandatory in every platform's version (Professional = paragraph form; Casual = short punchy lines; Inspirational = emotive rhythmic storytelling; Educational = scaffolded lesson with points + takeaway). The platform spec then adapts length and formatting around that structure. Deviation will be rejected. ${toneDirective}

CONTENT CATEGORY (detected): ${category.name}. ${category.note} ${linkedinDepth}

ABSOLUTE RULES — VIOLATION = REJECTED:
1. NEVER start any caption with "I want you to generate" or repeat the user's instruction verbatim. Transform the request into finished posts.
2. Every caption MUST be ABOUT the subject: "${clean}" — not a copy of the instruction. Subject core: "${clean.substring(0, 220)}". No generic productivity advice unless the subject is productivity.
3. FACT GROUNDING: use ONLY facts the user supplied. NEVER invent prices, dates, statistics, product specs, awards, testimonials, URLs, discounts, or claims. If details are thin, write around what is known — do not fill gaps with fiction.
4. Inclusive language only. If request contained sexualized language ("sexy girl"), rewrite to "professional host / presenter unboxing" — no sexualization.
5. Mention the key terms (${topicKeywords || clean}) naturally, not as copied instruction.
6. PLATFORM DIFFERENTIATION IS MANDATORY: each platform's caption must be structurally different (different hook, different paragraphing, different CTA, different length profile). Sharing facts is required; sharing sentences is forbidden. Two captions that read as copies with swapped words will be rejected.
7. TONE STRUCTURE IS MANDATORY (see TONE LOCK): Professional output that is not in paragraph form, Casual output written as a formal essay, Inspirational output without an emotional arc, or Educational output without a lesson structure will be rejected.
8. IMAGE_PROMPT RULE: ${hasImage
    ? 'An image was attached. "image_prompt" MUST describe the ACTUAL visible content of that attached image — real subjects, setting, colors, composition, on-image text if any — specific enough that regenerating from it would recreate a similar scene. It must NOT be a generic phrase like "professional scene" or "general social media post", and must NOT reuse the literal wording shown in the JSON skeleton below (that is a FORMAT example only, not sample text to copy).'
    : '"image_prompt" must describe a concrete scene for the real topic/subject above — specific enough to recreate it, not a generic placeholder, and not copied from the JSON skeleton below.'}

Topic (cleaned): "${clean}"
Original Topic: "${topic}"
Selected platforms (generate ONLY these — no other keys): ${selected.join(', ') || 'linkedin'}
Tone: ${tone}
${imageNote ? 'Image: ' + imageNote : ''}

PLATFORM SPECS (apply exactly the spec of each selected platform):
${platformSections}

JSON exactly (ONLY selected platform keys, no extras, no empty objects for unselected platforms):
{
  "platforms": {
    ${jsonFields || '"linkedin": { "caption": "...", "hashtags": [...] }'}
  },
  "image_prompt": "<your own fresh, specific prompt per the IMAGE_PROMPT RULE above — do not copy this placeholder text>"
}

Write original, platform-native content now.`;
}

function captionSimilarity(a, b) {
  const words = (s) => s.toLowerCase().replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const sa = new Set(words(a));
  const sb = new Set(words(b));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function needsDifferentiationRetry(result, platforms) {
  const keys = platforms.filter((k) => result.platforms[k]?.caption);
  if (keys.length < 2) return false;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (captionSimilarity(result.platforms[keys[i]].caption, result.platforms[keys[j]].caption) > 0.85) return true;
    }
  }
  return false;
}

const DIFFERENTIATION_NOTE = '\n\nDIFFERENTIATION PASS (previous drafts were near-identical — rejected): rewrite every platform caption so no two share the same hook, paragraph structure, or CTA. Keep all facts identical. WhatsApp keeps zero hashtags and native *bold*/list formatting.';

function validateStructure(data) {
  if (!data || typeof data !== 'object') return false;
  if (!data.platforms || typeof data.platforms !== 'object') return false;
  if (!data.image_prompt || typeof data.image_prompt !== 'string') return false;
  for (const key of Object.keys(data.platforms)) {
    const p = data.platforms[key];
    if (!p.caption || typeof p.caption !== 'string') return false;
    if (!Array.isArray(p.hashtags)) return false;
  }
  return true;
}

function extractJSON(text) {
  const matches = [];
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
        if (candidate.includes('"platforms"')) matches.push(candidate);
        start = -1;
      }
    }
  }
  if (matches.length > 0) return matches[matches.length - 1];
  return null;
}

async function callMercury(prompt, systemPrompt, timeoutMs = TEXT_TIMEOUT_MS, model = MERCURY_MODEL) {
  if (prompt.includes('__FORCE_MERCURY_FAIL__')) {
    throw new Error('Mercury API error: 503 (forced fallback test)');
  }
  if (!INCEPTION_API_KEY) throw new Error('Inception API key not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(INCEPTION_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${INCEPTION_API_KEY}` },
      body: JSON.stringify({ model, reasoning_effort: MERCURY_REASONING_EFFORT, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }], max_tokens: 2500, temperature: 0.6, top_p: 0.9 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mercury API error: ${response.status}`);
    }
    const data = await response.json();
    const message = data.choices?.[0]?.message ?? {};
    const raw = typeof message.content === 'string' ? message.content : '';
    if (!raw.trim() && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      const salvaged = message.tool_calls.map((tc) => tc?.function?.arguments).filter((a) => typeof a === 'string' && a.trim().length > 0).join('\n');
      if (salvaged.trim()) return salvaged.trim();
    }
    if (!raw.trim()) throw new Error('Mercury returned an empty completion (content null, no tool text) — retry');
    return raw.trim();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error(`Mercury API timeout (${Math.round(timeoutMs / 1000)}s) — please retry`);
    throw err;
  }
}

const NVIDIA_TIMEOUT_MS = 60_000;
const NVIDIA_COOLOFF_MS = 10 * 60 * 1000;
let nvidiaDownUntil = 0;

async function callNVIDIA(prompt, systemPrompt, timeoutMs = NVIDIA_TIMEOUT_MS, model = TEXT_MODEL) {
  if (!NVIDIA_API_KEY) throw new Error('NVIDIA API key not configured');
  if (Date.now() < nvidiaDownUntil) throw new Error('NVIDIA fallback is in cool-off — skipping without waiting');
  const budget = Math.min(timeoutMs, NVIDIA_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const response = await fetch(NVIDIA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${NVIDIA_API_KEY}` },
      body: JSON.stringify({ model, chat_template_kwargs: { thinking: false }, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }], max_tokens: 2500, temperature: 0.6, top_p: 0.9 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`NVIDIA API error: ${response.status}`);
    const data = await response.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      nvidiaDownUntil = Date.now() + NVIDIA_COOLOFF_MS;
      throw new Error(`NVIDIA API timeout (${Math.round(budget / 1000)}s) — please retry`);
    }
    throw err;
  }
}

async function callVisionWithImage(imageData, systemPrompt, userPrompt, timeoutMs = 90000, model = VISION_MODEL) {
  if (!NVIDIA_API_KEY) throw new Error('NVIDIA API key not configured');
  const list = (Array.isArray(imageData) ? imageData : [imageData]).slice(0, 4);
  const toDataUrl = (d) => d.startsWith('data:') ? d : `data:image/jpeg;base64,${d}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(NVIDIA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${NVIDIA_API_KEY}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: [...list.map((u) => ({ type: 'image_url', image_url: { url: toDataUrl(u) } })), { type: 'text', text: list.length > 1 ? `[${list.length} reference images attached — consider ALL of them] ${userPrompt}` : userPrompt }] }], max_tokens: 2000, temperature: 0.55 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      const errorText = await response.text();
      if (response.status >= 500) throw new Error(`Vision API error (${model}): ${response.status} (transient)`);
      throw new Error(`Vision API error (${model}): ${response.status}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error(`Vision API timeout (${Math.round(timeoutMs / 1000)}s)`);
    throw err;
  }
}

async function normalizeImageForVision(input) {
  const raw = input.includes(',') ? input.split(',').pop() : input;
  const buf = Buffer.from(raw, 'base64');
  const isSmallJpeg = buf.length < 100_000 && buf[0] === 0xff && buf[1] === 0xd8;
  if (isSmallJpeg) return input.startsWith('data:') ? input : `data:image/jpeg;base64,${raw}`;
  try {
    const { default: sharp } = await import('sharp');
    const out = await sharp(buf).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch {
    return input.startsWith('data:') ? input : `data:image/jpeg;base64,${raw}`;
  }
}

async function withVisionRetry(label, fn, retries = 1) {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const retryable = /timeout|429|5\d\d|fetch failed|ECONNRESET/i.test(msg);
    if (retries > 0 && retryable) {
      await new Promise((r) => setTimeout(r, 3000));
      return await fn();
    }
    throw err;
  }
}

async function analyzeImageSeparately(imageData, timeoutMs = 60000, model = VISION_MODEL) {
  if (!NVIDIA_API_KEY) throw new Error('NVIDIA API key not configured');
  const list = (Array.isArray(imageData) ? imageData : [imageData]).slice(0, 4);
  const toDataUrl = (d) => d.startsWith('data:') ? d : `data:image/jpeg;base64,${d}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(NVIDIA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${NVIDIA_API_KEY}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: [...list.map((u) => ({ type: 'image_url', image_url: { url: toDataUrl(u) } })), { type: 'text', text: list.length > 1 ? `Describe EACH of these ${list.length} images in 1-2 sentences (label them Image 1, Image 2...) covering subject, setting, objects, colors, mood — for a LinkedIn caption. Be specific.` : 'Describe this image in detail (subject, setting, objects, colors, mood) in 2-3 sentences for a LinkedIn caption. Be specific.' }] }], max_tokens: 350 + list.length * 150, temperature: 0.45 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`Vision API error: ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error(`Vision analysis timeout (${Math.round(timeoutMs / 1000)}s)`);
    throw err;
  }
}

function raceToFirst(tasks) {
  return new Promise((resolve) => {
    let pending = tasks.length;
    let won = false;
    if (pending === 0) { resolve(null); return; }
    for (const run of tasks) {
      run().then((out) => {
        if (out && !won) { won = true; resolve(out); return; }
        pending--;
        if (pending === 0 && !won) resolve(null);
      });
    }
  });
}

function repairHashtags(jsonStr) {
  return jsonStr.replace(/("hashtags"\s*:\s*\[)([^\]]*)(\])/g, (_m, open, inner, close) => {
    const items = inner.split(',').map((t) => {
      const tok = t.trim();
      if (!tok || tok.startsWith('"')) return tok;
      return `"${tok}"`;
    });
    return `${open}${items.join(',')}${close}`;
  });
}

function tolerantParse(raw) {
  const platMatch = raw.match(/"platforms"\s*:\s*{\s*"(\w+)"/);
  const platName = platMatch?.[1] || 'linkedin';
  const capMatch = raw.match(/"caption"\s*:\s*"([\s\S]*?)"\s*,\s*"hashtags"/);
  if (!capMatch) return null;
  const caption = capMatch[1].replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (caption.length < 80) return null;
  const tagsMatch = raw.match(/"hashtags"\s*:\s*\[([\s\S]*?)\]/);
  const hashtags = [];
  if (tagsMatch) {
    for (const tok of tagsMatch[1].split(',')) {
      const t = tok.trim().replace(/^["'#\s]+|["'\s]+$/g, '').replace(/\s+/g, '');
      if (t && !/[{}[\]":]/.test(t)) hashtags.push(t);
    }
  }
  const ipMatch = raw.match(/"image_prompt"\s*:\s*"([\s\S]*?)"\s*[},]/);
  const imagePrompt = ipMatch?.[1].replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim() || 'professional social media photo';
  return { platforms: { [platName]: { caption, hashtags } }, image_prompt: imagePrompt };
}

function sanitizeHashtags(tags) {
  const seen = new Set();
  const cleaned = [];
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

function parseAndValidate(raw) {
  let jsonString = extractJSON(raw);
  if (!jsonString) return null;
  jsonString = jsonString.replace(/[ -]+/g, ' ');

  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    try {
      parsed = JSON.parse(repairHashtags(jsonString));
    } catch {
      const rescued = tolerantParse(raw);
      if (rescued) parsed = rescued;
      else return null;
    }
  }

  if (parsed.caption && (!parsed.platforms || typeof parsed.platforms !== 'object' || Array.isArray(parsed.platforms))) {
    const platName = typeof parsed.platforms === 'string' ? parsed.platforms : 'linkedin';
    const tags = Array.isArray(parsed.hashtags) ? parsed.hashtags : (parsed.hashtags ? [parsed.hashtags] : []);
    parsed = { platforms: { [platName]: { caption: parsed.caption, hashtags: tags } }, image_prompt: parsed.image_prompt || '' };
  }

  const caption = parsed?.platforms?.linkedin?.caption || Object.values(parsed.platforms || {})[0]?.caption || '';
  const lowerCap = caption.toLowerCase();
  if (lowerCap.startsWith('i want you to generate') || lowerCap.includes('i want you to generate the context for')) return null;
  if (caption.includes('your content') || caption.includes('hashtag') || caption.length < 80) return null;
  if (!validateStructure(parsed)) return null;
  // Safety net for the IMAGE_PROMPT RULE above: if the model ignored the
  // instruction and either echoed the "don't copy this" skeleton text
  // verbatim, or fell back to the old generic phrasing, treat it as an
  // invalid response so the normal fallback-model chain retries instead of
  // the user getting an image generated from leaked instruction text or a
  // prompt unrelated to their actual image/topic.
  const imgPromptLower = (parsed.image_prompt || '').toLowerCase();
  if (imgPromptLower.includes('do not copy this placeholder') || imgPromptLower.includes('your own fresh, specific prompt')) return null;

  const result = parsed;
  for (const key of Object.keys(result.platforms)) {
    result.platforms[key].hashtags = sanitizeHashtags(result.platforms[key].hashtags);
  }
  const wa = result.platforms['whatsapp'];
  if (wa && typeof wa.caption === 'string') {
    wa.caption = wa.caption.replace(/#[A-Za-z0-9_]+/g, ' ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    wa.hashtags = [];
  }
  return result;
}

export async function generateContent(prompt, platforms, tone, hasImage, imageData, imageDataList) {
  const systemPrompt = buildSystemPrompt(platforms, tone, hasImage, prompt || 'general social media post');

  if (hasImage && (imageDataList?.length || imageData)) {
    const rawImgs = (Array.isArray(imageDataList) && imageDataList.length ? imageDataList : [imageData]).slice(0, 4);
    const imgs = await Promise.all(rawImgs.map(normalizeImageForVision));
    const imgLabel = imgs.length > 1 ? `${imgs.length} images` : 'image';
    const directPrompt = prompt
      ? `Generate a social media post about: "${prompt}", using ALL ${imgLabel} attached as visual reference. Return JSON with platforms and image_prompt.`
      : `Look at ALL ${imgLabel} attached and generate a social media post about them. Return JSON with platforms and image_prompt.`;

    const raceDirect = (model) => async () => {
      try {
        const raw = await callVisionWithImage(imgs, systemPrompt, directPrompt, 60000, model);
        const result = parseAndValidate(raw);
        if (result) return { model, result };
      } catch { /* out of the race */ }
      return null;
    };
    const winner = await raceToFirst(VISION_MODELS.map(raceDirect));
    if (winner) return winner.result;

    for (const model of VISION_MODELS) {
      try {
        const analysis = await withVisionRetry(`Two-step/${model}`, () => analyzeImageSeparately(imgs, 45000, model));
        if (analysis) {
          const desc = analysis.replace(/["\\\n\r\t]/g, ' ').substring(0, 900).trim();
          const userPrompt = prompt ? `Topic: ${prompt}\n\nImage analysis (${imgs.length} image${imgs.length === 1 ? '' : 's'}): ${desc}` : `Create a social media post based on these images: ${desc}`;
          try {
            const raw = await callMercury(userPrompt, systemPrompt, TEXT_TIMEOUT_MS, MERCURY_MODEL);
            const result = parseAndValidate(raw);
            if (result) return result;
          } catch (e) {
            if (/timeout/i.test(e.message)) throw e;
          }
          const raw = await callNVIDIA(userPrompt, systemPrompt, TEXT_TIMEOUT_MS, TEXT_MODEL);
          const result = parseAndValidate(raw);
          if (result) return result;
          const strictSystem = systemPrompt + '\n\nSTRICT JSON ONLY: Respond with just the JSON object starting with { and ending with }. No explanation, no markdown, no line breaks inside strings.';
          try {
            const rawStrictMercury = await callMercury(userPrompt, strictSystem, TEXT_TIMEOUT_MS, MERCURY_MODEL);
            const resultStrictMercury = parseAndValidate(rawStrictMercury);
            if (resultStrictMercury) return resultStrictMercury;
          } catch { /* fall through */ }
          const rawStrict = await callNVIDIA(userPrompt, strictSystem, TEXT_TIMEOUT_MS, TEXT_FALLBACK_MODEL !== TEXT_MODEL ? TEXT_FALLBACK_MODEL : TEXT_MODEL);
          const resultStrict = parseAndValidate(rawStrict);
          if (resultStrict) return resultStrict;
        }
      } catch { /* try next model */ }
    }
    throw new Error('Vision models are slow right now — please retry, or generate without an image.');
  }

  const cleanedPrompt = cleanTopic(prompt) || 'Create a social media post';
  const userPrompt = `Write the post about: "${cleanedPrompt}". Transform the request into a final post — do NOT echo the instruction. Topic tone: ${tone}.`;
  const scopeToSelected = (r) => {
    const scoped = {};
    for (const p of platforms) if (r.platforms[p]) scoped[p] = r.platforms[p];
    return Object.keys(scoped).length ? { ...r, platforms: scoped } : r;
  };

  let activeSystem = systemPrompt;
  try {
    const raw = await callMercury(userPrompt, activeSystem, TEXT_TIMEOUT_MS, MERCURY_MODEL);
    const result = parseAndValidate(raw);
    if (result) {
      let scoped = scopeToSelected(result);
      const minWords = linkedinMinWords(prompt);
      // Only pay for a second sequential round-trip when the draft is
      // substantially short — a near-miss isn't worth doubling latency for.
      if (platforms.includes('linkedin') && scoped.platforms['linkedin'] && linkedinWordCount(scoped) < minWords * 0.75) {
        try {
          const rawExp = await callMercury(userPrompt, systemPrompt + `\n\nEXPANSION REQUIRED: your previous draft was too short (under ${minWords} words for LinkedIn). Rewrite it FULLY at ${minWords}+ words with fuller context, concrete detail, and structured • points — same facts, no invented details. Output the complete JSON again.`, TEXT_TIMEOUT_MS, MERCURY_MODEL);
          const resultExp = parseAndValidate(rawExp);
          if (resultExp) scoped = scopeToSelected(resultExp);
        } catch (e) {
          if (/timeout/i.test(e.message)) throw e;
        }
      }
      if (!needsDifferentiationRetry(scoped, platforms)) return scoped;
      activeSystem = systemPrompt + DIFFERENTIATION_NOTE;
    }
  } catch (e) {
    if (/timeout/i.test(e.message)) throw e;
  }

  try {
    const raw = await callNVIDIA(userPrompt, activeSystem, TEXT_TIMEOUT_MS, TEXT_MODEL);
    const result = parseAndValidate(raw);
    if (result) return scopeToSelected(result);
  } catch (e) {
    if (/timeout/i.test(e.message)) throw e;
  }

  const retrySystem = activeSystem + '\n\nSTRICT JSON ONLY: Respond with just the JSON object starting with { and ending with }. No explanation. Do NOT start caption with "I want you to generate".';
  try {
    const rawStrictMercury = await callMercury(userPrompt, retrySystem, TEXT_TIMEOUT_MS, MERCURY_MODEL);
    const resultStrictMercury = parseAndValidate(rawStrictMercury);
    if (resultStrictMercury) return scopeToSelected(resultStrictMercury);
  } catch { /* fall through to NVIDIA strict */ }
  const raw2 = await callNVIDIA(userPrompt, retrySystem, TEXT_TIMEOUT_MS, TEXT_FALLBACK_MODEL !== TEXT_MODEL ? TEXT_FALLBACK_MODEL : TEXT_MODEL);
  const result2 = parseAndValidate(raw2);
  if (result2) return scopeToSelected(result2);
  throw new Error('AI is echoing the prompt — please rewrite your topic more concisely (e.g., "Car launch event with Grand Reveal, Key Features, Live Launch...") and try again.');
}
