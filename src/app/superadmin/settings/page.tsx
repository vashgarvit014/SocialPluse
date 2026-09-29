import { requireSuperadmin } from '@/lib/auth/roles';
import SettingsClient from './settings-client';

export default async function SuperadminSettingsPage() {
  const { user } = await requireSuperadmin();
  return <SettingsClient name={user.name} email={user.email} />;
}
