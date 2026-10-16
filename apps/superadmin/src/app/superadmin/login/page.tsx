import { Suspense } from 'react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import SuperadminLoginClient from './auth-client';
import { detectPhoneCountry } from '@/lib/phone-countries';
import './login.css';

export const metadata: Metadata = { title: 'Superadmin Access — SocialPulse' };

export default async function SuperadminLoginPage() {
  // The client reads ?animationDebug, so it needs a Suspense boundary for the
  // route to stay statically renderable.
  return (
    <Suspense fallback={null}>
      <SuperadminLoginClient initialCountry={detectPhoneCountry(await headers())} />
    </Suspense>
  );
}
