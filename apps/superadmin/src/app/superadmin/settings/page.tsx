import { redirect } from 'next/navigation';
import { requireSuperadminSession } from '@/lib/session';
import { callAdminService } from '@/lib/admin-client';
import SettingsClient from './settings-client';

export default async function SuperadminSettingsPage() {
  const session = await requireSuperadminSession();
  if ('redirect' in session) redirect('/superadmin/login');
  const profile = await callAdminService<{ user: { name: string; email: string } }>(`/users/${session.userId}`);
  const name = profile.ok ? profile.data.user.name : 'Superadmin';
  const email = profile.ok ? profile.data.user.email : '';
  return <SettingsClient name={name} email={email} />;
}
