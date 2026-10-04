// Faithful port of src/lib/moderation.ts. Every pattern, threshold, and the
// 3-layer order (local intent -> classifier -> provider) preserved exactly
// — this is safety-critical, not something to "simplify" in translation.

import { createHash } from 'node:crypto';

const EXPLICIT_SEXUAL_PATTERNS = [
  /\b(porn|porno|pornographic|xxx)\b/i,
  /\bsexually\s+explicit\b/i,
  /\bexplicit\s+(nude|nudity|sexual)\b/i,
  /\bsexual\s+(act|acts|intercourse|motion)\b/i,
  /\b(have|having|perform|performing|engage in)\s+sex\b/i,
  /\b(nude|naked)\s+(sex|sexual|erotic|erotically)\b/i,
  /\b(oral|anal)\s+sex\b/i,
  /\b(genitals|penis|vagina|testicles)\s+(exposed|visible|showing)\b/i,
  /\b(show|display|depict)\s+(me\s+)?(your\s+)?(genitals|penis|vagina|testicles|breasts)\b/i,
  /\b(fully\s+)?naked\s+(woman|man|girl|boy|person)\b/i,
  /\b(erotic|sexual)\s+(photo|photograph|picture|image|shot|porn)\b/i,
];
const EXPOSURE_PATTERNS = [
  /\btopless\b/i,
  /\b(undressed|unclothed)\b/i,
  /\bbare[- ]?(chested|backed|buttocks|breasts)\b/i,
  /\b(exposed|visible|showing)\s+(breasts|cleavage|genitals|buttocks|penis|vagina)\b/i,
  /\b(fully|fully|complete|total|completely|totally)\s+nude\b/i,
  /\bnude\b/i,
  /\bnaked\b/i,
  /\bwithout\s+(any\s+)?(clothes|clothing|underwear)\b/i,
];
const DEPICTION_PATTERNS = [
  /\b(photo|photograph|photography|pic|picture|image|imagery|selfie|snapshot|shoot|shooting|render|rendering|depict|depiction|visual|scene)\b/i,
  /\b(show|showing|display|displaying)\b/i,
  /\bof\s+a\s+(real|actual|living)\b/i,
  /\b(real|actual|living)\s+(person|woman|man|girl|boy|model)\b/i,
];
const STATIC_ART_PATTERNS = [
  /\b(sculpture|statue|marble|bust|renaissance|baroque|classical|neoclassical|museum|gallery|fresco|mural|etching|engraving|woodcut|painting|canvas|portrait)\b/i,
  /\b(medical|clinical|anatom\w*|patholog\w*|dermatolog\w*|histolog\w*|educational|textbook|diagram|schematic|anatomical plate)\b/i,
  /\b(academic|study|studies|life[- ]?drawing|figure drawing|reference sheet)\b/i,
];
const REAL_PERSON_PATTERNS = [
  /\b(photo|photograph|photography|selfie|snapshot)\b/i,
  /\breal\b/i,
  /\b(actual|living)\b/i,
  /\byour\b/i,
  /\b(you|self|me)\b/i,
];
const SEXUAL_INTENT_PATTERNS = [
  /\bporn\w*\b/i,
  /\bxxx\b/i,
  /\bsexually\s+explicit\b/i,
  /\bexplicit\s+(sexual|nude|nudity)\b/i,
  /\bsexual\s+(imagery|content|scene|act|encounter|material)\b/i,
  /\berotic\w*\b/i,
  /\b(have|having|perform|performing)\s+sex\b/i,
  /\b(oral|anal)\s+sex\b/i,
  /\bsexually\s+posed\b/i,
];
const PERSON_NOUN_PATTERNS = [
  /\b(man|men|woman|women|girl|boys?|boy|person|people|model|figure|adult|lad\w*|guy|guys|female|male|teen\w*|couple|partner|intimate\w*)\b/i,
];

function matchesAny(text, patterns) {
  return patterns.some((re) => re.test(text));
}
function normalise(text) {
  return text.toLowerCase()
    .replace(/[4]/g, 'a').replace(/[3]/g, 'e').replace(/[1!|]/g, 'i').replace(/[0]/g, 'o')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const BENIGN_CONTEXT_PATTERNS = [
  /\b(medical|clinical|anatomical|anatomy|patholog\w*|dermatolog\w*|histolog\w*|educational|diagram|schematic|textbook|plate)\b/i,
  /\b(health|healthcare|patient|diagnosis|symptom|disease|condition|disorder|clinic|hospital)\b/i,
  /\b(museum|gallery|sculpture|statue|marble|renaissance|baroque|classical|neoclassical|art history|fine art|masterpiece|mural|fresco)\b/i,
  /\b(study|studies|sketch|reference|poster|illustration|life[- ]?drawing|figure drawing)\b/i,
  /\b(pregnan\w*|breastfeed\w*|mother|infant|maternity|newborn|postpartum)\b/i,
  /\b(fitness|athletic|sportswear|gym|swimwear|beachwear|yoga)\b/i,
];
export function benignContextScore(text) {
  let hits = 0;
  for (const re of BENIGN_CONTEXT_PATTERNS) if (re.test(text)) hits++;
  return hits;
}

export function localIntentCheck(rawPrompt) {
  const text = normalise(rawPrompt);
  if (!text) return null;
  const benign = benignContextScore(text);

  for (const re of EXPLICIT_SEXUAL_PATTERNS) {
    if (re.test(rawPrompt)) {
      return { decision: 'BLOCK_EXPLICIT_SEXUAL', method: 'INTENT', confidence: 0.9, reason: 'Request describes explicit sexual content', countsAsViolation: true, severity: 'WARNING' };
    }
  }
  if (matchesAny(rawPrompt, SEXUAL_INTENT_PATTERNS)) {
    if (matchesAny(rawPrompt, DEPICTION_PATTERNS) || matchesAny(rawPrompt, PERSON_NOUN_PATTERNS)) {
      return { decision: 'BLOCK_EXPLICIT_SEXUAL', method: 'INTENT', confidence: 0.9, reason: 'Request describes explicit sexual content', countsAsViolation: true, severity: 'WARNING' };
    }
    return null;
  }
  const exposed = matchesAny(rawPrompt, EXPOSURE_PATTERNS);
  const depicted = matchesAny(rawPrompt, DEPICTION_PATTERNS);
  const person = matchesAny(rawPrompt, PERSON_NOUN_PATTERNS);
  if (exposed && depicted && person) {
    const staticFraming = matchesAny(rawPrompt, STATIC_ART_PATTERNS);
    const realPerson = matchesAny(rawPrompt, REAL_PERSON_PATTERNS);
    if (staticFraming && !realPerson) return null;
    if (benign >= 2 && !realPerson) return null;
    return { decision: 'BLOCK_NUDITY', method: 'INTENT', confidence: benign >= 1 ? 0.65 : 0.85, reason: 'Request asks to depict an exposed or undressed person', countsAsViolation: true, severity: 'WARNING' };
  }
  return null;
}

const INCEPTION_BASE_URL = process.env.INCEPTION_API_BASE || 'https://api.inceptionlabs.ai/v1';
const INCEPTION_API_KEY = process.env.INCEPTION_API_KEY;
const INCEPTION_MODEL = process.env.INCEPTION_TEXT_MODEL || 'mercury-2.5';
const INCEPTION_REASONING_EFFORT = process.env.INCEPTION_REASONING_EFFORT || 'low';
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_MODEL = process.env.NVIDIA_TEXT_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';

const CLASSIFIER_TIMEOUT_MS = 20_000;
const CLASSIFIER_MAX_TOKENS = 1200;

const CLASSIFIER_SYSTEM = `You are a content-safety classifier for an image-generation product.

Classify the user's image prompt into exactly one label:

BLOCK_EXPLICIT_SEXUAL
  The prompt requests pornographic content, sexual acts, genitalia shown
  explicitly, or sexually explicit depiction of a person.

BLOCK_NUDITY
  The prompt requests a nude or undressed real person, exposed breasts or
  buttocks, or a "topless" style photo of a person.

BLOCK_OTHER_SAFETY
  Requests for graphic violence, gore, child sexual abuse material, hate
  symbols, or self-harm instructions.

ALLOW
  Everything else. In particular, ALL of the following are ALLOW and must
  never be treated as nudity or sexual content:
  - medical, clinical, anatomical, pathology, dermatology or educational
    references to body parts (including breasts, skin, anatomy, pregnancy)
  - breastfeeding, maternity, newborn and infant imagery
  - fine art, classical or renaissance sculpture, statues, paintings, museum
    pieces, and figure-drawing studies
  - fitness, athletic, swimwear or sportswear photography
  - the words "body", "skin", "art", "nude" used to describe sculpture or
    academic study of the human form
  - the word "naked" used in a historical, journalistic or educational context

Judge the request as a whole, in context. A single anatomical or artistic word
does not make a prompt sexual. When a prompt has a legitimate framing such as
medical, educational or fine-art, prefer ALLOW.

Respond with ONLY a JSON object, nothing else:
{"label":"ALLOW|BLOCK_NUDITY|BLOCK_EXPLICIT_SEXUAL|BLOCK_OTHER_SAFETY","confidence":0.0-1.0,"reason":"<=15 words, no prompt quotes"}`;

async function callChat(baseUrl, apiKey, model, system, user, extra = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0.5, max_tokens: CLASSIFIER_MAX_TOKENS, ...extra, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const content = data.choices?.[0]?.message?.content;
    return typeof content === 'string' && content.trim() ? content : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function parseClassifierVerdict(raw) {
  if (!raw) return null;
  const fenced = raw.match(/\{[\s\S]*\}/);
  const text = fenced ? fenced[0] : raw;
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const label = String(parsed.label || '').toUpperCase();
  const allowed = ['ALLOW', 'BLOCK_NUDITY', 'BLOCK_EXPLICIT_SEXUAL', 'BLOCK_OTHER_SAFETY'];
  if (!allowed.includes(label)) return null;
  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.8;
  return { label, confidence, reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 120) : undefined };
}

async function classifierCheck(prompt) {
  const providers = [];
  if (INCEPTION_API_KEY) providers.push({ base: INCEPTION_BASE_URL, key: INCEPTION_API_KEY, model: INCEPTION_MODEL, name: 'inception', extra: { reasoning_effort: INCEPTION_REASONING_EFFORT } });
  if (NVIDIA_API_KEY) providers.push({ base: NVIDIA_BASE_URL, key: NVIDIA_API_KEY, model: NVIDIA_MODEL, name: 'nvidia' });

  for (const p of providers) {
    const raw = await callChat(p.base, p.key, p.model, CLASSIFIER_SYSTEM, prompt, p.extra);
    const verdict = parseClassifierVerdict(raw || '');
    if (!verdict) continue;
    if (verdict.label === 'ALLOW') return { kind: 'allow' };
    if (verdict.confidence < 0.6) return { kind: 'allow' };
    const sexual = verdict.label === 'BLOCK_NUDITY' || verdict.label === 'BLOCK_EXPLICIT_SEXUAL';
    return { kind: 'block', result: { decision: verdict.label, method: 'CLASSIFIER', confidence: verdict.confidence, reason: verdict.reason || 'Classified as prohibited content', countsAsViolation: sexual, severity: 'WARNING', provider: p.name } };
  }
  return { kind: 'unavailable' };
}

const LOCAL_CONFIDENCE_FLOOR = 0.8;

export async function moderatePrompt(prompt, opts = {}) {
  const trimmed = (prompt || '').trim();
  const allow = { decision: 'ALLOW', method: 'INTENT', countsAsViolation: false, severity: 'INFO' };
  if (!trimmed) return { ...allow, method: 'DISABLED' };

  const local = localIntentCheck(trimmed);
  if (local && local.confidence !== undefined && local.confidence >= LOCAL_CONFIDENCE_FLOOR) return local;
  if (opts.skipClassifier) return { ...allow, method: 'INTENT' };

  const outcome = await classifierCheck(trimmed);
  if (outcome.kind === 'block') return outcome.result;
  return { ...allow, method: 'CLASSIFIER' };
}

export function providerSafetyDecision(status, body) {
  if (status !== 400 || !/safety system|content polic|nsfw/i.test(body || '')) return null;
  const explicit = /\b(explicit|sexual|porn|nudity|nude)\b/i.test(body || '');
  return { decision: explicit ? 'BLOCK_EXPLICIT_SEXUAL' : 'BLOCK_NUDITY', method: 'PROVIDER', confidence: 1, reason: 'Image provider safety system rejected the request', countsAsViolation: true, severity: 'WARNING', provider: 'pollinations' };
}

export function promptFingerprint(prompt) {
  return createHash('sha256').update(normalise(prompt)).digest('hex').slice(0, 32);
}

export const MODERATION_USER_MESSAGE =
  "This request can't be processed because it appears to request nudity or sexually explicit content, which isn't supported by SocialPulse. Please revise your request. Repeated attempts may result in your account being flagged for review.";
