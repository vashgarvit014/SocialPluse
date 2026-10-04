# @socialpulse/validation — scaffold only

This package is a placeholder, created to match the repository's planned
target layout. It is **not wired into any build** and nothing imports it.

Intended future purpose: the password/OTP/email/mobile validation rules
currently duplicated verbatim between `apps/web`'s
`src/lib/auth/{schemas,password-rules,format-rules,mobile}.ts` and
`services/auth-service/src/{schemas,password-rules,format-rules,
mobile}.mjs` (kept byte-for-byte identical by hand since the auth-service
extraction) — a natural first candidate to actually move here. Building
this is real, separate work — not done as part of the folder restructure
that created this stub.
