// Pure, framework-agnostic format checks — deliberately NOT 'server-only' so
// the exact same rule the server enforces can also run in the browser for
// instant feedback (see schemas.ts, which both the client and every API
// route import). No secrets, no DB, no Node-only APIs here.

// Human names: one or more letter-runs (Unicode-aware, so this isn't
// Latin-only) optionally joined by a single apostrophe/hyphen, each run
// optionally ending in a period for abbreviations — separated by
// whitespace. Rejects digits and symbol-only input without being fussy
// about scripts/diacritics.
const NAME_TOKEN_RE = /^\p{L}+(?:['-]\p{L}+)*\.?$/u;

export function isValidName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  const tokens = trimmed.split(/\s+/);
  return tokens.length > 0 && tokens.every(t => NAME_TOKEN_RE.test(t));
}

// Practical email format: local part is one or more "atext" runs joined by
// single dots (so ".." / leading / trailing dots are rejected without a
// lookahead), domain is one or more DNS labels (1-63 chars, alnum with
// interior hyphens only) joined by dots, at least one label after the last
// dot (a real TLD-shaped ending — not "abc@gmail"). Domain-agnostic: any
// syntactically valid domain passes, nothing Gmail-specific.
const EMAIL_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function isValidEmailFormat(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}
