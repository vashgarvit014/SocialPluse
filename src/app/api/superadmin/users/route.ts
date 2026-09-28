import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { listUsers, createAdminManagedUser, findUserByEmail, findUserByMobile } from '@/lib/auth/users';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';
import { nameSchema, emailSchema, mobileSchema } from '@/lib/auth/schemas';
import { validationErrorResponse } from '@/lib/auth/validation-response';
import { z } from 'zod';

const createUserSchema = z.object({ name: nameSchema, email: emailSchema, mobile: mobileSchema });

export async function GET(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const params = request.nextUrl.searchParams;
  const search = params.get('search') || undefined;
  const statusParam = params.get('status');
  const status = statusParam === 'ACTIVE' || statusParam === 'PENDING' || statusParam === 'SUSPENDED' ? statusParam : undefined;
  const limit = Math.min(Math.max(Number(params.get('limit')) || 20, 1), 100);
  const offset = Math.max(Number(params.get('offset')) || 0, 0);

  const { users, total } = await listUsers({ search, status, limit, offset });
  return NextResponse.json({ users, total, limit, offset });
}

// Creates a normal USER (never SUPERADMIN — this route has no `role` field
// at all, so there is nothing for a request body to tamper with; see
// users.ts#createAdminManagedUser, which is hardcoded to role='USER').
export async function POST(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);
  const { name, email, mobile } = parsed.data;

  if (await findUserByEmail(email)) {
    return NextResponse.json({ error: 'VALIDATION_ERROR', fields: { email: 'An account with this email already exists.' } }, { status: 400 });
  }
  if (await findUserByMobile(mobile)) {
    return NextResponse.json({ error: 'VALIDATION_ERROR', fields: { mobile: 'An account with this mobile number already exists.' } }, { status: 400 });
  }

  const user = await createAdminManagedUser(name, email, mobile);
  logAuthEvent('USER_CREATED_BY_ADMIN', { userId: user.id, ip: clientIp(request), meta: { createdBy: session.userId } });

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, mobile: user.mobile, status: user.status, role: user.role, createdAt: user.createdAt },
  }, { status: 201 });
}
