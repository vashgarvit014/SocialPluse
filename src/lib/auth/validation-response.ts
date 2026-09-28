import 'server-only';
import { NextResponse } from 'next/server';
import type { z } from 'zod';

// One issue per field (the first one encountered) — enough to drive inline
// field errors on the client without dumping a raw Zod error tree. Never
// includes a stack trace or any value the user submitted.
export function validationErrorResponse(error: z.ZodError): NextResponse {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !(key in fields)) fields[key] = issue.message;
  }
  return NextResponse.json({ error: 'VALIDATION_ERROR', fields }, { status: 400 });
}
