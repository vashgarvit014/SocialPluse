// Scaffold only — not wired into any build. Intended future purpose:
// cross-service TypeScript types currently duplicated between apps/web's
// own TS interfaces and the equivalent shapes documented (but not
// type-shared) in each service's own .mjs files, and partially covered
// today by packages/api-contracts' Zod schemas.
export const SCAFFOLD = true;
