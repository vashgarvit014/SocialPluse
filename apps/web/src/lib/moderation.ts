import 'server-only';
import { createHash } from 'node:crypto';

// Content moderation for image-generation prompts.
//
// WHY THIS IS NOT KEYWORD MATCHING
// ---------------------------------
// The obvious implementation — block if the prompt contains "nude", "breast",
// "topless" — is wrong in both directions and is explicitly ruled out here.
// It produces false positives on entirely legitimate briefs ("a medical
// illustration of breast anatomy", "a sculpture garden with nude classical
// statues", "a breastfeeding mother", "art study of the human body in
// renaissance style"), and false negatives on everything phrased around the
// banned word.
//
// So a single word NEVER blocks. A decision requires one of:
//
//   1. CLASSIFIER  — a real contextual model judges whether the request, taken
//                    as a whole, is a request for sexual nudity. This is the
//                    primary path when a chat-completions provider is
//                    configured (the app already has NVIDIA/Inception keys).
//   2. PROVIDER    — the image provider's own safety rejection, which is
//                    authoritative by construction. Used to confirm a request
//                    the classifier was unsure about.
//   3. INTENT      — a local fallback for deployments with no classifier. This
//                    is NOT single-word matching: it requires an explicit
//                    sexual/nudity REQUEST (a sexual act or a demand for
//                    exposed genitals/sexualised nudity) rather than the mere
//                    presence of anatomy vocabulary, and it is suppressed
//                    outright when the prompt is dominated by an educational,
//                    medical or fine-art framing.

export type ModerationDecision = 'ALLOW' | 'BLOCK_NUDITY' | 'BLOCK_EXPLICIT_SEXUAL' | 'BLOCK_SUGGESTIVE' | 'BLOCK_MINOR_SEXUAL' | 'NEEDS_CLARIFICATION' | 'BLOCK_OTHER_SAFETY';
export type ModerationSeverity = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
export type ModerationMethod = 'CLASSIFIER' | 'PROVIDER' | 'INTENT' | 'DISABLED';

/** User-facing safety category: exactly one of the five pre-generation outcomes. */
export type SafetyCategory = 'SAFE' | 'SEXUAL_EXPLICIT' | 'SEXUAL_SUGGESTIVE' | 'MINOR_SEXUAL' | 'UNCERTAIN' | 'OTHER_SAFETY';

/** Maps an internal decision to the user-facing category. BLOCK_NUDITY (e.g. a
 *  topless photo) is presented as sexually suggestive, matching the taxonomy
 *  that suggestive nudity belongs with provocative content, not explicit acts. */
export function decisionToCategory(decision: ModerationDecision): SafetyCategory {
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

export interface ModerationResult {
  decision: ModerationDecision;
  method: ModerationMethod;
  /** 0..1 classifier confidence. Absent for non-classifier methods. */
  confidence?: number;
  /** Short, NON-VERBATIM reason safe to store and show to an admin. */
  reason?: string;
  /** True only for confirmed prohibited sexual/nudity. Drives the counter. */
  countsAsViolation: boolean;
  severity: ModerationSeverity;
  provider?: string;
}

// ---------------------------------------------------------------------------
// Layer 3 — local intent detection (fallback only)
// ---------------------------------------------------------------------------

/**
 * Explicit sexual acts / requests. These are unambiguous in ANY context: there
 * is no legitimate art, medical or educational brief that asks for these.
 */
const EXPLICIT_SEXUAL_PATTERNS: RegExp[] = [
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

/**
 * Nudity detection is split into an EXPOSURE descriptor and a DEPICTION
 * context rather than one tight adjacency pattern.
 *
 * An earlier version used proximity patterns ("topless <noun>"), which
 * under-detected natural phrasings ("topless photo of a woman showing her
 * breasts", "erotic nude photography session") while over-matching art
 * references ("nude classical figure"). Requiring both signals across the whole
 * prompt, with an explicit art/medical escape, handles both cases: a real
 * depiction of an exposed person is caught however it is phrased, and a
 * museum/medical brief is not.
 */
const EXPOSURE_PATTERNS: RegExp[] = [
  /\btopless\b/i,
  /\b(undressed|unclothed)\b/i,
  /\bbare[- ]?(chested|backed|buttocks|breasts)\b/i,
  /\b(exposed|visible|showing)\s+(breasts|cleavage|genitals|buttocks|penis|vagina)\b/i,
  /\b(fully|fully|complete|total|completely|totally)\s+nude\b/i,
  /\bnude\b/i,
  /\bnaked\b/i,
  /\bwithout\s+(any\s+)?(clothes|clothing|underwear)\b/i,
];

/** A medium or act that actually depicts a person. */
const DEPICTION_PATTERNS: RegExp[] = [
  /\b(photo|photograph|photography|pic|picture|image|imagery|selfie|snapshot|shoot|shooting|render|rendering|depict|depiction|visual|scene)\b/i,
  /\b(show|showing|display|displaying)\b/i,
  /\bof\s+a\s+(real|actual|living)\b/i,
  /\b(real|actual|living)\s+(person|woman|man|girl|boy|model)\b/i,
];

/**
 * Framing that makes an exposed body legitimate. Only honoured when the
 * request is about a static artwork, an anatomical/educational plate or an
 * academic study — never when it also asks for a photograph of a real person.
 */
const STATIC_ART_PATTERNS: RegExp[] = [
  /\b(sculpture|statue|marble|bust|renaissance|baroque|classical|neoclassical|museum|gallery|fresco|mural|etching|engraving|woodcut|painting|canvas|portrait)\b/i,
  /\b(medical|clinical|anatom\w*|patholog\w*|dermatolog\w*|histolog\w*|educational|textbook|diagram|schematic|anatomical plate)\b/i,
  /\b(academic|study|studies|life[- ]?drawing|figure drawing|reference sheet)\b/i,
];

/** Anchors that force the "this is a photo of a real person" reading. */
const REAL_PERSON_PATTERNS: RegExp[] = [
  /\b(photo|photograph|photography|selfie|snapshot)\b/i,
  /\breal\b/i,
  /\b(actual|living)\b/i,
  /\byour\b/i,
  /\b(you|self|me)\b/i,
];

/**
 * Unambiguous sexual intent. Each of these is prohibited in ANY framing —
 * there is no legitimate art, medical or educational brief that asks for
 * pornography or sexual imagery. Kept separate from EXPOSURE so a medical or
 * artistic reference to a body is never swept up by it.
 */
const SEXUAL_INTENT_PATTERNS: RegExp[] = [
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

/**
 * Highest-priority subject signals: anyone who is, or might be, under 18.
 * "Teen" is deliberately always treated as a minor here — in a sexual
 * context an ambiguous young-looking subject must never be assumed adult.
 * These nouns alone never block; they only matter combined with a sexual
 * context (checked first in localIntentCheck), so family, school and
 * maternity content is unaffected.
 */
const MINOR_NOUN_PATTERNS: RegExp[] = [
  /\b(child|children|kid|kids|kiddie|minor|underage|preteen|pre-teen|teen|teenager|teenage|baby|babies|toddler|infant|newborn|schoolboy|schoolgirl|youngster)\b/i,
  /\bschool[ -]?(boy|girl|child|kid)\b/i,
];

/** Explicit under-18 age statements ("15-year-old", "age 15", "15yo"). */
const UNDERAGE_PATTERNS: RegExp[] = [
  /\b(1[0-7]|0?[0-9])\s*(-|–)?\s*(year|yr)s?\s*(-|\s)?old\b/i,
  /\bage\s*(is|:)?\s*(1[0-7]|0?[0-9])\b/i,
  /\b(1[0-7]|0?[0-9])\s*yo\b/i,
  /\bunder\s*18\b/i,
];

/**
 * Sexually suggestive / soft-pornographic framing: content primarily intended
 * to be sexually provocative without describing an explicit sex act. Kept
 * tight on purpose — bare anatomy words ("skin", "breast", "body") are NOT
 * here, so medical, maternity, fitness and swimwear briefs never match.
 */
const SUGGESTIVE_PATTERNS: RegExp[] = [
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

/**
 * The subject has to be a person. "a photo of a nude" is an unfinished phrase,
 * and "a photo of a nude statue" is an artwork — neither is a request for a
 * nude photograph of a person, so neither may block on the exposure word alone.
 */
const PERSON_NOUN_PATTERNS: RegExp[] = [
  /\b(man|men|woman|women|girl|boys?|boy|person|people|model|figure|adult|lad\w*|guy|guys|female|male|teen\w*|couple|partner|intimate\w*)\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(re => re.test(text));
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    // Collapse leetspeak used to slip past naive filters.
    .replace(/[4]/g, 'a')
    .replace(/[3]/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Framing that makes anatomy vocabulary legitimate, used as a soft signal that
 * lowers confidence rather than as a hard allow. A hard allow lives in
 * STATIC_ART_PATTERNS above; this is the "two or more independent legitimate
 * framings" escape hatch.
 */
const BENIGN_CONTEXT_PATTERNS: RegExp[] = [
  /\b(medical|clinical|anatomical|anatomy|patholog\w*|dermatolog\w*|histolog\w*|educational|diagram|schematic|textbook|plate)\b/i,
  /\b(health|healthcare|patient|diagnosis|symptom|disease|condition|disorder|clinic|hospital)\b/i,
  /\b(museum|gallery|sculpture|statue|marble|renaissance|baroque|classical|neoclassical|art history|fine art|masterpiece|mural|fresco)\b/i,
  /\b(study|studies|sketch|reference|poster|illustration|life[- ]?drawing|figure drawing)\b/i,
  /\b(pregnan\w*|breastfeed\w*|mother|infant|maternity|newborn|postpartum)\b/i,
  /\b(fitness|athletic|sportswear|gym|swimwear|beachwear|yoga)\b/i,
];

/** Counts how strongly the prompt reads as educational/medical/art. */
export function benignContextScore(text: string): number {
  let hits = 0;
  for (const re of BENIGN_CONTEXT_PATTERNS) if (re.test(text)) hits++;
  return hits;
}

/**
 * Layer 3 result. Returns BLOCK_*, or null when the local pass finds nothing
 * (meaning "no local signal" — NOT "allow", because the caller still runs the
 * classifier first and always applies the provider check).
 */
export function localIntentCheck(rawPrompt: string): ModerationResult | null {
  const text = normalise(rawPrompt);
  if (!text) return null;
  const benign = benignContextScore(text);

  // ---- Highest priority: minor + sexual context. Checked before everything
  // else, and never suppressed by art/medical framing. A non-sexual prompt
  // about a minor (family photo, school project) returns null here — this
  // gate only acts when a sexual context is also present.
  const minorSubject = matchesAny(rawPrompt, MINOR_NOUN_PATTERNS) || matchesAny(rawPrompt, UNDERAGE_PATTERNS);
  if (minorSubject) {
    const sexualContext =
      matchesAny(rawPrompt, EXPLICIT_SEXUAL_PATTERNS) ||
      matchesAny(rawPrompt, SEXUAL_INTENT_PATTERNS) ||
      matchesAny(rawPrompt, SUGGESTIVE_PATTERNS) ||
      (matchesAny(rawPrompt, EXPOSURE_PATTERNS) &&
        (matchesAny(rawPrompt, DEPICTION_PATTERNS) || matchesAny(rawPrompt, PERSON_NOUN_PATTERNS)));
    if (sexualContext) {
      return {
        decision: 'BLOCK_MINOR_SEXUAL',
        method: 'INTENT',
        confidence: 0.95,
        reason: 'Request combines a minor with sexual content',
        countsAsViolation: true,
        severity: 'CRITICAL',
      };
    }
    return null;
  }

  // ---- Sexually suggestive / soft-pornographic framing. Checked before the
  // explicit-act patterns so "soft-porn" style briefs land in the suggestive
  // category they belong to rather than the explicit one.
  if (matchesAny(rawPrompt, SUGGESTIVE_PATTERNS)) {
    if (matchesAny(rawPrompt, DEPICTION_PATTERNS) || matchesAny(rawPrompt, PERSON_NOUN_PATTERNS)) {
      return {
        decision: 'BLOCK_SUGGESTIVE',
        method: 'INTENT',
        confidence: 0.85,
        reason: 'Request is sexually suggestive',
        countsAsViolation: true,
        severity: 'WARNING',
      };
    }
    return null;
  }

  for (const re of EXPLICIT_SEXUAL_PATTERNS) {
    if (re.test(rawPrompt)) {
      // Even in a medical/art frame, an explicit sexual ACT is a violation.
      // Anatomy vocabulary is what gets the exemption, not sexual acts.
      return {
        decision: 'BLOCK_EXPLICIT_SEXUAL',
        method: 'INTENT',
        confidence: 0.9,
        reason: 'Request describes explicit sexual content',
        countsAsViolation: true,
        severity: 'WARNING',
      };
    }
  }

  // ---- Unambiguous sexual intent: blocked regardless of framing. ----
  if (matchesAny(rawPrompt, SEXUAL_INTENT_PATTERNS)) {
    if (matchesAny(rawPrompt, DEPICTION_PATTERNS) || matchesAny(rawPrompt, PERSON_NOUN_PATTERNS)) {
      return {
        decision: 'BLOCK_EXPLICIT_SEXUAL',
        method: 'INTENT',
        confidence: 0.9,
        reason: 'Request describes explicit sexual content',
        countsAsViolation: true,
        severity: 'WARNING',
      };
    }
    // A bare phrase with no depiction context at all is not enough to act on.
    return null;
  }

  const exposed = matchesAny(rawPrompt, EXPOSURE_PATTERNS);
  const depicted = matchesAny(rawPrompt, DEPICTION_PATTERNS);
  const person = matchesAny(rawPrompt, PERSON_NOUN_PATTERNS);
  // Both an exposure descriptor AND a depiction context AND an actual person.
  // All three are required: this is what makes "a photo of a nude" and
  // "a nude statue" safe while "topless photo of a woman" is not.
  if (exposed && depicted && person) {
    // Art / medical / academic framing wins UNLESS the request is also asking
    // for a photographic depiction of a real person. This is the single
    // exception that makes "a topless statue of venus" safe while "topless
    // photo of a woman" is not.
    const staticFraming = matchesAny(rawPrompt, STATIC_ART_PATTERNS);
    const realPerson = matchesAny(rawPrompt, REAL_PERSON_PATTERNS);
    if (staticFraming && !realPerson) return null;
    if (benign >= 2 && !realPerson) return null;
    return {
      decision: 'BLOCK_NUDITY',
      method: 'INTENT',
      confidence: benign >= 1 ? 0.65 : 0.85,
      reason: 'Request asks to depict an exposed or undressed person',
      countsAsViolation: true,
      severity: 'WARNING',
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Layer 1 — contextual classifier
// ---------------------------------------------------------------------------

const INCEPTION_BASE_URL = process.env.INCEPTION_API_BASE || 'https://api.inceptionlabs.ai/v1';
const INCEPTION_API_KEY = process.env.INCEPTION_API_KEY;
const INCEPTION_MODEL = process.env.INCEPTION_TEXT_MODEL || 'mercury-2.5';
const INCEPTION_REASONING_EFFORT = process.env.INCEPTION_REASONING_EFFORT || 'low';
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_MODEL = process.env.NVIDIA_TEXT_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';

const CLASSIFIER_TIMEOUT_MS = 20_000;
// Generous, because the configured provider is a REASONING model: with a small
// budget it spends every token thinking and returns content:null, which looks
// identical to "no verdict" and used to fail OPEN (see classifierCheck).
const CLASSIFIER_MAX_TOKENS = 1200;

/**
 * Asks a text model to judge the prompt as a whole.
 *
 * The prompt is deliberately framed around CONTEXT, and the rubric calls out
 * the exact categories that must be allowed — that instruction is what stops a
 * model from pattern-matching "breast" and refusing a medical illustration.
 */
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

interface ClassifierVerdict {
  label: ModerationDecision;
  confidence: number;
  reason?: string;
}

async function callChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  user: string,
  extra: Record<string, unknown> = {},
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        // This provider rejects temperature 0 (it clamps to 1 and warns), and
        // low temperature is not required for a JSON verdict anyway.
        temperature: 0.5,
        max_tokens: CLASSIFIER_MAX_TOKENS,
        ...extra,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({})) as {
      choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
    };
    const choice = data.choices?.[0];
    // content:null with finish_reason 'length' means the reasoning model ran
    // out of budget. Treat that as "could not decide", never as "allowed".
    const content = choice?.message?.content;
    return typeof content === 'string' && content.trim() ? content : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pulls the JSON verdict out of a model response, tolerating code fences. */
export function parseClassifierVerdict(raw: string): ClassifierVerdict | null {
  if (!raw) return null;
  const fenced = raw.match(/\{[\s\S]*\}/);
  const text = fenced ? fenced[0] : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const label = String(obj.label || '').toUpperCase() as ModerationDecision;
  const allowed: ModerationDecision[] = ['ALLOW', 'BLOCK_NUDITY', 'BLOCK_EXPLICIT_SEXUAL', 'BLOCK_SUGGESTIVE', 'BLOCK_MINOR_SEXUAL', 'NEEDS_CLARIFICATION', 'BLOCK_OTHER_SAFETY'];
  if (!allowed.includes(label)) return null;
  const confidence = typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : 0.8;
  return {
    label,
    confidence,
    reason: typeof obj.reason === 'string' ? obj.reason.slice(0, 120) : undefined,
  };
}

/**
 * A classifier outcome is one of three things, and the distinction matters:
 *
 *   block        the model returned a usable BLOCK_* verdict
 *   allow        the model returned a usable ALLOW verdict  -> trust it
 *   unavailable  network error, non-200, empty content, or unparseable output
 *
 * "unavailable" must NOT be collapsed into "allow". An earlier version did
 * exactly that, so a reasoning model that exhausted its token budget turned
 * every request into an allowance.
 */
type ClassifierOutcome =
  | { kind: 'block'; result: ModerationResult }
  | { kind: 'allow' }
  | { kind: 'unavailable' };

async function classifierCheck(prompt: string): Promise<ClassifierOutcome> {
  const providers: Array<{ base: string; key: string; model: string; name: string; extra?: Record<string, unknown> }> = [];
  if (INCEPTION_API_KEY) providers.push({ base: INCEPTION_BASE_URL, key: INCEPTION_API_KEY, model: INCEPTION_MODEL, name: 'inception', extra: { reasoning_effort: INCEPTION_REASONING_EFFORT } });
  if (NVIDIA_API_KEY) providers.push({ base: NVIDIA_BASE_URL, key: NVIDIA_API_KEY, model: NVIDIA_MODEL, name: 'nvidia' });

  for (const p of providers) {
    const raw = await callChat(p.base, p.key, p.model, CLASSIFIER_SYSTEM, prompt, p.extra);
    const verdict = parseClassifierVerdict(raw || '');
    if (!verdict) continue;
    if (verdict.label === 'ALLOW') return { kind: 'allow' };
    // An explicit NEEDS_CLARIFICATION verdict, or any block verdict the model
    // itself is unsure about, becomes a clarification request — never a silent
    // generate, and never a violation on the account. Ambiguous age or sexual
    // intent must ask the user to rewrite, not guess.
    const needsClarification = verdict.label === 'NEEDS_CLARIFICATION' || verdict.confidence < 0.6;
    if (needsClarification) {
      return {
        kind: 'block',
        result: {
          decision: 'NEEDS_CLARIFICATION',
          method: 'CLASSIFIER',
          confidence: verdict.confidence,
          reason: verdict.reason || 'Prompt needs clarification before generation',
          countsAsViolation: false,
          severity: 'INFO',
          provider: p.name,
        },
      };
    }
    const sexual = verdict.label === 'BLOCK_NUDITY' || verdict.label === 'BLOCK_EXPLICIT_SEXUAL' || verdict.label === 'BLOCK_SUGGESTIVE' || verdict.label === 'BLOCK_MINOR_SEXUAL';
    return {
      kind: 'block',
      result: {
        decision: verdict.label,
        method: 'CLASSIFIER',
        confidence: verdict.confidence,
        reason: verdict.reason || 'Classified as prohibited content',
        // Only confirmed prohibited sexual/nudity feeds the escalation counter.
        // Other safety categories still block the request but are not "nudity
        // violations" and must not accumulate against an account.
        countsAsViolation: sexual,
        severity: 'WARNING',
        provider: p.name,
      },
    };
  }
  // Every configured provider failed to produce a usable verdict.
  return { kind: 'unavailable' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Threshold above which the local intent pass may count as confirmed. */
const LOCAL_CONFIDENCE_FLOOR = 0.8;

export interface ModerateOptions {
  /** Skip the classifier (e.g. a live provider pre-check already happened). */
  skipClassifier?: boolean;
}

/**
 * Full moderation decision for a generation prompt.
 *
 * Order matters: the classifier runs first because it is the only layer that
 * understands context; the local intent pass only runs if no classifier is
 * available or the classifier was inconclusive, so a configured deployment
 * never falls back to regex.
 */
export async function moderatePrompt(prompt: string, opts: ModerateOptions = {}): Promise<ModerationResult> {
  const trimmed = (prompt || '').trim();
  const allow: ModerationResult = { decision: 'ALLOW', method: 'INTENT', countsAsViolation: false, severity: 'INFO' };
  if (!trimmed) return { ...allow, method: 'DISABLED' };

  // ---- Layer 3 first: cheap, high-precision, no network ------------
  // Unambiguous sexual intent and explicit nude-depiction requests are decided
  // here. Running this BEFORE the classifier matters for latency: the
  // classifier is a reasoning model that can take 1-20s, and an obviously
  // prohibited request should not make the user wait for it.
  const local = localIntentCheck(trimmed);
  if (local && local.confidence !== undefined && local.confidence >= LOCAL_CONFIDENCE_FLOOR) return local;

  if (opts.skipClassifier) return { ...allow, method: 'INTENT' };

  // ---- Layer 1: contextual judgement -------------------------------
  // Reached for everything the local pass did not clearly block, which is the
  // entire benign corpus plus genuinely borderline cases. This is what keeps
  // "medical illustration of breast anatomy" and "marble sculpture of a nude
  // figure" out of the enforcement path.
  const outcome = await classifierCheck(trimmed);
  if (outcome.kind === 'block') return outcome.result;
  // An explicit ALLOW from a working classifier is authoritative. "unavailable"
  // also lands here, and is correct: the local pass already had its chance, so
  // the request is allowed. It must NOT be allowed merely because a provider
  // was configured — an unreachable classifier is not an all-clear.
  return { ...allow, method: 'CLASSIFIER' };
}

/**
 * Layer 2 — the image provider's own safety rejection.
 *
 * Pollinations reports a content-safety refusal as HTTP 400 with "safety
 * system" in the body. That verdict is authoritative and is treated as a
 * confirmed prohibited-content signal even if the classifier let it through.
 */
export function providerSafetyDecision(status: number, body: string): ModerationResult | null {
  if (status !== 400 || !/safety system|content polic|nsfw/i.test(body || '')) return null;
  const explicit = /\b(explicit|sexual|porn|nudity|nude)\b/i.test(body || '');
  return {
    decision: explicit ? 'BLOCK_EXPLICIT_SEXUAL' : 'BLOCK_NUDITY',
    method: 'PROVIDER',
    confidence: 1,
    reason: 'Image provider safety system rejected the request',
    countsAsViolation: true,
    severity: 'WARNING',
    provider: 'pollinations',
  };
}

/** Stable, non-reversible fingerprint of a prompt. Never the prompt itself. */
export function promptFingerprint(prompt: string): string {
  return createHash('sha256').update(normalise(prompt)).digest('hex').slice(0, 32);
}

export const MODERATION_USER_MESSAGE =
  "This request can't be processed because it appears to request nudity or sexually explicit content, which isn't supported by SocialPulse. Please revise your request. Repeated attempts may result in your account being flagged for review.";

/** Distinct, precise user-facing copy per safety category. No scores,
 *  thresholds, hidden rules or provider policy text — only what to change. */
export interface SafetyBlockCopy {
  code: 'PROMPT_REQUIRES_REVISION' | 'PROMPT_BLOCKED';
  category: SafetyCategory;
  title: string;
  message: string;
  guidance: string[];
  exampleInstead?: string;
  exampleUse?: string;
}

const SAFETY_COPY: Record<Exclude<SafetyCategory, 'SAFE'>, Omit<SafetyBlockCopy, 'category'>> = {
  SEXUAL_EXPLICIT: {
    code: 'PROMPT_REQUIRES_REVISION',
    title: 'Content not allowed',
    message: 'This prompt requests explicit sexual content, so it can’t be generated.',
    guidance: [
      'explicit sexual acts',
      'pornographic descriptions',
      'sexualized nudity',
      'fetish content',
    ],
    exampleInstead: 'Generate an explicit erotic bedroom scene...',
    exampleUse: 'Generate a romantic cinematic portrait of an adult couple in an elegant bedroom, fully clothed.',
  },
  SEXUAL_SUGGESTIVE: {
    code: 'PROMPT_REQUIRES_REVISION',
    title: 'Please revise your prompt',
    message: 'This prompt is too sexually suggestive for generation.',
    guidance: [
      'erotic posing',
      'sexually provocative framing',
      'sexualized nudity',
      'body-focused sexual descriptions',
    ],
    exampleInstead: 'Create a seductive lingerie model posing on a bed...',
    exampleUse: 'Create a high-fashion editorial portrait of an adult model in elegant eveningwear.',
  },
  MINOR_SEXUAL: {
    code: 'PROMPT_BLOCKED',
    title: 'This request cannot be processed',
    message: 'Sexual content involving minors is not allowed.',
    guidance: [
      'make sure all subjects are clearly adults, AND',
      'remove all sexual or exploitative elements.',
    ],
  },
  UNCERTAIN: {
    code: 'PROMPT_REQUIRES_REVISION',
    title: 'Please clarify your prompt',
    message: 'This prompt may include sexualized content or an unclear age reference.',
    guidance: [
      'make sure all people are clearly adults where relevant',
      'request no explicit or sexually exploitative content',
    ],
  },
  OTHER_SAFETY: {
    code: 'PROMPT_REQUIRES_REVISION',
    title: 'Content not allowed',
    message: MODERATION_USER_MESSAGE,
    guidance: [],
  },
};

/** Builds the full pre-generation block payload for a decision. The original
 *  prompt is never included and never sent anywhere after classification. */
export function moderationBlockCopy(decision: ModerationDecision): SafetyBlockCopy {
  const category = decisionToCategory(decision);
  if (category === 'SAFE') throw new Error('moderationBlockCopy called for an ALLOW decision');
  const copy = SAFETY_COPY[category];
  return { category, ...copy };
}