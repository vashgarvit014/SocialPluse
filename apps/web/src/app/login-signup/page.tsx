import type { Metadata } from 'next';
import { Suspense } from 'react';
import AuthClient from './auth-client';

export const metadata: Metadata = {
  title: 'Log in or sign up — SocialPulse',
  description: 'Log in or create a SocialPulse account.',
};

export default function LoginSignupPage() {
  return (
    <Suspense>
      <AuthClient />
    </Suspense>
  );
}
