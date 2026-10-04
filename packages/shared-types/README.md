# @socialpulse/shared-types — scaffold only

This package is a placeholder, created to match the repository's planned
target layout. It is **not wired into any build** and nothing imports it.

Intended future purpose: cross-service TypeScript types currently
duplicated between `apps/web`'s own interfaces and the equivalent shapes
used (but not type-shared) across the `services/*` `.mjs` files, and
partially overlapping today with `packages/api-contracts`' Zod schemas.
Building this is real, separate work — not done as part of the folder
restructure that created this stub.
