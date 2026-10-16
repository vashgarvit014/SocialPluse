import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Suspense } from 'react';
import AuthClient from './auth-client';
import { detectPhoneCountry } from '@/lib/phone-countries';

export const metadata: Metadata = {
  title: 'Log in or sign up — SocialPulse',
  description: 'Log in or create a SocialPulse account.',
};

export default async function LoginSignupPage() {
  const initialCountry = detectPhoneCountry(await headers());
  return (
    <Suspense>
      <AuthClient initialCountry={initialCountry} />
    </Suspense>
  );
}
