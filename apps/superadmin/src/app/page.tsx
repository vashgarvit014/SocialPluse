import { redirect } from 'next/navigation';
import { verifySuperadminSession } from '@/lib/session';

// Mirrors the original monolith proxy.ts's superadmin-host "/" behavior:
// signed-in -> dashboard, signed-out -> login. No hostname branching
// needed here (this app only ever serves one surface).
export default async function RootPage() {
  const session = await verifySuperadminSession();
  redirect(session ? '/superadmin' : '/superadmin/login');
}
