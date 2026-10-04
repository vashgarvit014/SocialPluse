// Scaffold only — not wired into any build. Intended future purpose: the
// password/OTP/email/mobile format-and-strength validation rules
// currently duplicated verbatim between apps/web's src/lib/auth/{schemas,
// password-rules,format-rules,mobile}.ts and
// services/auth-service/src/{schemas,password-rules,format-rules,
// mobile}.mjs (kept byte-for-byte identical by hand since Phase 9 — a
// natural first candidate to actually move here).
export const SCAFFOLD = true;
