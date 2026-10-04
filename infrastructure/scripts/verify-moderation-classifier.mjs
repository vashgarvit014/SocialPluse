#!/usr/bin/env node
/**
 * Content-moderation CLASSIFIER verification (offline, no server required).
 *
 *   npm run test:moderation-classifier
 *
 * This is the half that catches the failure mode the brief explicitly rules
 * out: naive keyword matching. It runs the real decision function over
 *
 *   - prompts that MUST be allowed, including every anatomical/artistic word
 *     the brief names (nude, breast, body, skin, anatomy, pregnancy,
 *     breastfeeding, art, medical);
 *   - prohibited requests, phrased several different ways;
 *   - every single anatomical word in isolation, which must never block.
 *
 * A keyword implementation fails this suite immediately. It needs no database,
 * no provider keys and no running server.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const shim = join(process.cwd(), 'node_modules', 'server-only', 'empty.js');
const Module = require('node:module');
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'server-only') return shim;
  return orig.call(this, request, ...rest);
};

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  \u2713 ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` \u2014 ${detail}` : ''}`); console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n${t}`);
const truncate = (s, n = 58) => (s.length > n ? `${s.slice(0, n)}\u2026` : s);

const MUST_ALLOW = [
  'a medical illustration of human breast anatomy for a nursing textbook',
  'educational diagram of skin layers and anatomy',
  'a photo of a woman breastfeeding her newborn baby',
  'a marble sculpture of a nude classical figure in a museum gallery',
  'renaissance oil painting of a nude figure, fine art reproduction',
  'art study of the human body in charcoal, academic figure drawing',
  'pregnancy photography, expecting mother in a sunlit nursery',
  'a fitness athlete in sportswear mid-workout at the gym',
  'a dermatology close-up of healthy skin texture',
  'a topless statue of venus in a baroque museum hall',
  'a beach photo of a person in swimwear',
  'an anatomical chart of the human torso for a medical poster',
  'a classical nude marble statue in a museum, renaissance sculpture',
  'an academic nude figure drawing study in charcoal',
  'a newborn baby skin texture close-up, newborn photography',
];

const MUST_BLOCK = [
  'pornographic photo of a naked woman',
  'explicit sexual content of a couple having sex',
  'a fully nude photo of a real woman with exposed genitals',
  'topless photo of a woman showing her breasts',
  'create a nude selfie of a real person',
  'erotic nude photography session',
  'a photo of a naked man without any clothes',
  'show me a nude picture of a real woman',
  'generate sexual imagery of a couple',
];

const SINGLE_WORDS = ['nude', 'breast', 'body', 'skin', 'anatomy', 'pregnancy', 'breastfeeding', 'art', 'medical', 'chest', 'torso'];

async function main() {
  console.log('SocialPulse \u2014 content moderation classifier verification (offline)');
  console.log('='.repeat(60));

  const mod = await import('../src/lib/moderation.ts');
  check('Moderation module loaded', typeof mod.localIntentCheck === 'function');

  section('1. Benign contexts must NOT false-positive');
  for (const p of MUST_ALLOW) {
    const r = mod.localIntentCheck(p);
    check(`ALLOW: "${truncate(p)}"`, !r, r ? `blocked as ${r.decision} (${r.confidence})` : '');
  }

  section('2. Prohibited requests must be blocked');
  for (const p of MUST_BLOCK) {
    const r = mod.localIntentCheck(p);
    check(`BLOCK: "${truncate(p)}"`, !!r, 'got ALLOW');
  }

  section('3. No single anatomical / artistic word ever blocks on its own');
  for (const w of SINGLE_WORDS) {
    const r = mod.localIntentCheck(`a photo of a ${w}`);
    check(`Single word "${w}" does not block`, !r, r ? `blocked as ${r.decision}` : '');
    const r2 = mod.localIntentCheck(w);
    check(`Bare word "${w}" does not block`, !r2, r2 ? `blocked as ${r2.decision}` : '');
  }

  section('4. Decision shape and helpers');
  check('benignContextScore recognizes a medical framing', mod.benignContextScore('a medical illustration of anatomy') >= 1);
  check('benignContextScore returns 0 for a neutral prompt', mod.benignContextScore('a bicycle on a beach') === 0);
  check('parseClassifierVerdict handles fenced JSON', mod.parseClassifierVerdict('```json\n{"label":"BLOCK_NUDITY","confidence":0.9}\n```')?.label === 'BLOCK_NUDITY');
  check('parseClassifierVerdict rejects garbage', mod.parseClassifierVerdict('not json at all') === null);
  check('parseClassifierVerdict rejects an unknown label', mod.parseClassifierVerdict('{"label":"MAYBE","confidence":1}') === null);
  check('promptFingerprint is stable across case', mod.promptFingerprint('a Bicycle') === mod.promptFingerprint('a bicycle'));
  check('promptFingerprint is non-reversible', !mod.promptFingerprint('a bicycle on a beach').includes('bicycle'));
  check('promptFingerprint differs for different prompts', mod.promptFingerprint('a bicycle') !== mod.promptFingerprint('a car'));
  check('providerSafetyDecision recognises a provider refusal', mod.providerSafetyDecision(400, 'blocked by our safety system: sexual')?.decision === 'BLOCK_EXPLICIT_SEXUAL');
  check('providerSafetyDecision ignores unrelated 400s', mod.providerSafetyDecision(400, 'invalid size parameter') === null);
  check('providerSafetyDecision ignores non-400s', mod.providerSafetyDecision(429, 'safety system') === null);
  check('providerSafetyDecision verdict counts as a violation', mod.providerSafetyDecision(400, 'safety system')?.countsAsViolation === true);
  check('User-facing message mentions nudity and flagging',
    /nudity/i.test(mod.MODERATION_USER_MESSAGE) && /flagged/i.test(mod.MODERATION_USER_MESSAGE));

  console.log('\n' + '='.repeat(60));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log(`  - ${f}`)); }
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('\nFATAL:', e); process.exit(1); });
