import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { listUsers, findUserByEmail, createAdminManagedUser, type UserListItem } from '@/lib/auth/users';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';

export async function GET(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const params = request.nextUrl.searchParams;
  const query = params.get('query') || '';

  let users: UserListItem[] = [];
  let total = 0;

  if (query) {
    const searchTerm = `%${query}%`;
    const allUsers = await listUsers({ search: searchTerm, status: undefined, limit: 50, offset: 0 });
    users = allUsers.users;
    total = allUsers.total;
  }

  return NextResponse.json({ users, total, query });
}

function err(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

function successResponse(data: Record<string, unknown>) {
  return NextResponse.json({ success: true, ...data });
}

// Sends a collab invite to a user by email
// Creates a PENDING user account linked to the inviter (superadmin)
// The invited user receives OTP to activate their account
export async function POST(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('INVALID_REQUEST', 'Invalid request body.', 400);
  }

  const { targetEmail, targetName, message } = body as { targetEmail: string; targetName?: string; message?: string };

  if (!targetEmail || !targetEmail.includes('@')) {
    return err('VALIDATION_ERROR', 'A valid email address is required.', 400);
  }

  // Check if user already exists
  const existingByEmail = await findUserByEmail(targetEmail);
  if (existingByEmail) {
    return err('COLLAB_INVITE_EXISTS', `An account already exists with email ${targetEmail}. They are "${existingByEmail.status}" — you can reactivate or send to a different email.`, 409);
  }

  // Create a new PENDING user via the admin flow (mobile optional — empty string for collab invite)
  const user = await createAdminManagedUser(targetName || 'Collab Invitee', targetEmail, '');

  // Log the collab invite event
  logAuthEvent('COLLAB_INVITE_SENT', {
    userId: user.id,
    ip: clientIp(request),
    meta: { targetEmail: targetEmail || '', message: message || '' } as const,
  });

  return successResponse({
    user: { id: user.id, name: user.name, email: user.email, mobile: user.mobile, status: user.status, role: user.role, createdAt: user.createdAt },
    message: `Collab invite sent to ${targetEmail}. The invited user will receive an OTP to activate their account.`,
  });
}