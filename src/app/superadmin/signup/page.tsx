import type { Metadata } from 'next';
import SuperadminSignupClient from './signup-client';

export const metadata: Metadata = { title: 'Superadmin Setup — SocialPulse' };

export default function SuperadminSignupPage() {
  return <SuperadminSignupClient />;
}
