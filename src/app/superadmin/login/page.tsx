import type { Metadata } from 'next';
import SuperadminLoginClient from './auth-client';

export const metadata: Metadata = { title: 'Superadmin Access — SocialPulse' };

export default function SuperadminLoginPage() {
  return <SuperadminLoginClient />;
}
