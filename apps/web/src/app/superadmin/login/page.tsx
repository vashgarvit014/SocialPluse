import { Suspense } from 'react';
import type { Metadata } from 'next';
import SuperadminLoginClient from './auth-client';
import './login.css';

export const metadata: Metadata = { title: 'Superadmin Access — SocialPulse' };

export default function SuperadminLoginPage() {
  // The client reads ?animationDebug, so it needs a Suspense boundary for the
  // route to stay statically renderable.
  return (
    <Suspense fallback={null}>
      <SuperadminLoginClient />
    </Suspense>
  );
}
