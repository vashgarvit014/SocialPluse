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
const MINOR_NOUN_PATTERNS = [
  /\b(child|children|kid|kids|kiddie|minor|underage|preteen|pre-teen|teen|teenager|teenage|baby|babies|toddler|infant|newborn|schoolboy|schoolgirl|youngster)\b/i,
  /\bschool[ -]?(boy|girl|child|kid)\b/i,
];
const UNDERAGE_PATTERNS = [
  /\b(1[0-7]|0?[0-9])\s*(-|–)?\s*(year|yr)s?\s*(-|\s)?old\b/i,
  /\bage\s*(is|:)?\s*(1[0-7]|0?[0-9])\b/i,
  /\b(1[0-7]|0?[0-9])\s*yo\b/i,
  /\bunder\s*18\b/i,
];
const SUGGESTIVE_PATTERNS = [
  /\bsoft[\s-]?porn\b/i,
  /\blingerie\b/i,
  /\bseductive(ly)?\b/i,
  /\bsensual(ly)?\b/i,
  /\bprovocative(ly)?\b/i,
  /\bsexually\s+suggestive\b/i,
  /\berotic\s+pos\w*\b/i,
  /\bboudoir\b/i,
  /\bsexual(ly)?\s+(arous\w*|teas\w*)\b/i,
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

  // Highest priority: minor + sexual context. Never suppressed by framing.
  const minorSubject = matchesAny(rawPrompt, MINOR_NOUN_PATTERNS) || matchesAny(rawPrompt, UNDERAGE_PATTERNS);
  if (minorSubject) {
    const sexualContext =
      matchesAny(rawPrompt, EXPLICIT_SEXUAL_PATTERNS) ||
      matchesAny(rawPrompt, SEXUAL_INTENT_PATTERNS) ||
      matchesAny(rawPrompt, SUGGESTIVE_PATTERNS) ||
      (matchesAny(rawPrompt, EXPOSURE_PATTERNS) &&
        (matchesAny(rawPrompt, DEPICTION_PATTERNS) || matchesAny(rawPrompt, PERSON_NOUN_PATTERNS)));
    if (sexualContext) {
      return { decision: 'BLOCK_MINOR_SEXUAL', method: 'INTENT', confidence: 0.95, reason: 'Request combines a minor with sexual content', countsAsViolation: true, severity: 'CRITICAL' };
    }
    return null;
  }

  // Sexually suggestive / soft-pornographic framing, before explicit acts.
  if (matchesAny(rawPrompt, SUGGESTIVE_PATTERNS)) {
    if (matchesAny(rawPrompt, DEPICTION_PATTERNS) || matchesAny(rawPrompt, PERSON_NOUN_PATTERNS)) {
      return { decision: 'BLOCK_SUGGESTIVE', method: 'INTENT', confidence: 0.85, reason: 'Request is sexually suggestive', countsAsViolation: true, severity: 'WARNING' };
    }
    return null;
  }

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

BLOCK_SUGGESTIVE
  The prompt is primarily sexually provocative without describing an explicit
  sex act: lingerie-focused erotic posing, sexualized bedroom posing,
  "soft porn", sexually suggestive nudity, provocative body-focused
  compositions, or content clearly intended for sexual arousal.

BLOCK_MINOR_SEXUAL
  The prompt combines a minor — a child, teen, underage person, anyone
  described as under 18, or anyone of unclear/ambiguous young age — with
  sexual, erotic, nude, pornographic, fetishized or sexually suggestive
  content. When age is ambiguous in a sexual context, choose this label:
  never assume the subject is an adult.

NEEDS_CLARIFICATION
  The prompt may include sexualized content or an unclear age reference, but
  it cannot be confidently placed in a block category. Use this when age or
  sexual intent is genuinely ambiguous.

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
{"label":"ALLOW|BLOCK_NUDITY|BLOCK_EXPLICIT_SEXUAL|BLOCK_SUGGESTIVE|BLOCK_MINOR_SEXUAL|NEEDS_CLARIFICATION|BLOCK_OTHER_SAFETY","confidence":0.0-1.0,"reason":"<=15 words, no prompt quotes"}`;

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
  const allowed = ['ALLOW', 'BLOCK_NUDITY', 'BLOCK_EXPLICIT_SEXUAL', 'BLOCK_SUGGESTIVE', 'BLOCK_MINOR_SEXUAL', 'NEEDS_CLARIFICATION', 'BLOCK_OTHER_SAFETY'];
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
    // An explicit NEEDS_CLARIFICATION verdict, or any block verdict the model
    // itself is unsure about, becomes a clarification request — never a silent
    // generate, and never a violation on the account.
    const needsClarification = verdict.label === 'NEEDS_CLARIFICATION' || verdict.confidence < 0.6;
    if (needsClarification) {
      return { kind: 'block', result: { decision: 'NEEDS_CLARIFICATION', method: 'CLASSIFIER', confidence: verdict.confidence, reason: verdict.reason || 'Prompt needs clarification before generation', countsAsViolation: false, severity: 'INFO', provider: p.name } };
    }
    const sexual = verdict.label === 'BLOCK_NUDITY' || verdict.label === 'BLOCK_EXPLICIT_SEXUAL' || verdict.label === 'BLOCK_SUGGESTIVE' || verdict.label === 'BLOCK_MINOR_SEXUAL';
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

export function decisionToCategory(decision) {
  switch (decision) {
    case 'BLOCK_EXPLICIT_SEXUAL': return 'SEXUAL_EXPLICIT';
    case 'BLOCK_NUDITY':
    case 'BLOCK_SUGGESTIVE': return 'SEXUAL_SUGGESTIVE';
    case 'BLOCK_MINOR_SEXUAL': return 'MINOR_SEXUAL';
    case 'NEEDS_CLARIFICATION': return 'UNCERTAIN';
    case 'BLOCK_OTHER_SAFETY': return 'OTHER_SAFETY';
    default: return 'SAFE';
  }
}

const SAFETY_COPY = {
  SEXUAL_EXPLICIT: {
    code: 'PROMPT_REQUIRES_REVISION',
    title: 'Content not allowed',
    message: 'This prompt requests explicit sexual content, so it can’t be generated.',
    guidance: ['explicit sexual acts', 'pornographic descriptions', 'sexualized nudity', 'fetish content'],
    exampleInstead: 'Generate an explicit erotic bedroom scene...',
    exampleUse: 'Generate a romantic cinematic portrait of an adult couple in an elegant bedroom, fully clothed.',
  },
  SEXUAL_SUGGESTIVE: {
    code: 'PROMPT_REQUIRES_REVISION',
    title: 'Please revise your prompt',
    message: 'This prompt is too sexually suggestive for generation.',
    guidance: ['erotic posing', 'sexually provocative framing', 'sexualized nudity', 'body-focused sexual descriptions'],
    exampleInstead: 'Create a seductive lingerie model posing on a bed...',
    exampleUse: 'Create a high-fashion editorial portrait of an adult model in elegant eveningwear.',
  },
  MINOR_SEXUAL: {
    code: 'PROMPT_BLOCKED',
    title: 'This request cannot be processed',
    message: 'Sexual content involving minors is not allowed.',
    guidance: ['make sure all subjects are clearly adults, AND', 'remove all sexual or exploitative elements.'],
  },
  UNCERTAIN: {
    code: 'PROMPT_REQUIRES_REVISION',
    title: 'Please clarify your prompt',
    message: 'This prompt may include sexualized content or an unclear age reference.',
    guidance: ['make sure all people are clearly adults where relevant', 'request no explicit or sexually exploitative content'],
  },
  OTHER_SAFETY: {
    code: 'PROMPT_REQUIRES_REVISION',
    title: 'Content not allowed',
    message: MODERATION_USER_MESSAGE,
    guidance: [],
  },
};

export function moderationBlockCopy(decision) {
  const category = decisionToCategory(decision);
  if (category === 'SAFE') throw new Error('moderationBlockCopy called for an ALLOW decision');
  return { category, ...SAFETY_COPY[category] };
}
