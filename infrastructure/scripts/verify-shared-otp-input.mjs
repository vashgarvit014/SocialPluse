#!/usr/bin/env node
/**
 * Guards the ONE genuinely duplicated UI component in this repo: the OTP box
 * input, which must exist as a real local copy in BOTH apps.
 *
 * Why it is duplicated rather than imported from packages/ui:
 * `packages/` sits outside both apps' Docker build contexts
 * (`context: ./apps/web`, `context: ./apps/superadmin` in docker-compose.yml),
 * so a `file:` dependency there is never copied into the image, `npm install`
 * silently no-ops it, and `next build` then fails with `Module not found`.
 * That was tested for real and reverted for `packages/api-client` — see that
 * package's README and `apps/superadmin/src/lib/admin-client.ts`. Until the
 * Dockerfiles build from the repo root, duplication is forced by the deploy
 * topology and the only thing that can break is the copies drifting apart.
 *
 * This exact bug already shipped once: the box-state fix landed in apps/web
 * only, leaving the Superadmin email-change flow on the old broken component.
 *
 * So: verify byte-equality. Fix a mismatch with
 *   cp apps/web/src/app/login-signup/otp-input.tsx \
 *      apps/superadmin/src/app/login-signup/otp-input.tsx
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const COPIES = [
  'apps/web/src/app/login-signup/otp-input.tsx',
  'apps/superadmin/src/app/login-signup/otp-input.tsx',
];

const read = (p) => readFileSync(join(REPO, p), 'utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

let failed = false;
const contents = COPIES.map((p) => {
  let text;
  try {
    text = read(p);
  } catch {
    console.error(`FAIL  missing: ${p}`);
    failed = true;
    return null;
  }
  console.log(`read  ${p}  (${text.split('\n').length} lines, sha256:${sha(text)})`);
  return text;
});

if (contents.every(Boolean)) {
  const [a, b] = contents;
  if (a === b) {
    console.log(`\nPASS  all ${COPIES.length} OtpInput copies are byte-identical.`);
    console.log(`      Both apps render the same OTP input, so a fix applied to one`);
    console.log(`      cannot silently miss the other.`);
  } else {
    failed = true;
    const la = a.split('\n');
    const lb = b.split('\n');
    console.error(`\nFAIL  the OtpInput copies have DIVERGED.`);
    const n = Math.max(la.length, lb.length);
    let shown = 0;
    for (let i = 0; i < n && shown < 12; i++) {
      if (la[i] !== lb[i]) {
        console.error(`      line ${i + 1}:`);
        console.error(`        web        : ${JSON.stringify(la[i])}`);
        console.error(`        superadmin : ${JSON.stringify(lb[i])}`);
        shown++;
      }
    }
    if (shown >= 12) console.error(`      ... (more differences suppressed)`);
    console.error(`\n      Fix by making them identical — the apps/web copy is canonical:`);
    console.error(`        cp ${relative(process.cwd(), join(REPO, COPIES[0]))} \\`);
    console.error(`           ${relative(process.cwd(), join(REPO, COPIES[1]))}`);
    console.error(`\n      This component must NOT be redesigned per-app: both apps share`);
    console.error(`      one /api/auth/otp/* contract and one OTP UI.`);
  }
}

if (failed) {
  console.error('\nverify-shared-otp-input: FAILED');
  process.exit(1);
}
console.log('\nverify-shared-otp-input: OK');