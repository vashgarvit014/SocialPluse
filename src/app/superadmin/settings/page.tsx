import { requireSuperadmin } from '@/lib/auth/roles';
import { avatarColor, initials } from '../ui';

// Deliberately minimal per spec ("do not overbuild it") — just confirms who
// is signed in and how role/session security works here. No settings are
// actually mutable from this screen yet; there's nothing to add until a
// real need for one shows up.
export default async function SuperadminSettingsPage() {
  const { user } = await requireSuperadmin();

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ width: 44, height: 44, borderRadius: '50%', background: avatarColor(user.name), color: '#fff', fontSize: 15, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(user.name)}</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{user.name}</div>
          <div style={{ fontSize: 12.5, color: 'var(--mu)', marginTop: 2 }}>{user.email}</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--mu)', marginTop: 14, lineHeight: 1.6 }}>
        Additional Superadmin accounts can only be created via the <code style={{ fontFamily: 'var(--font-sa-mono), monospace' }}>npm run create-superadmin</code> seed script,
        run from a trusted terminal with direct database access — never through this UI.
      </div>
    </div>
  );
}
