import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import LoaderPreviewClient from './preview-client';

// DEVELOPMENT ONLY. In production builds this route answers 404, so the
// preview can never ship, appear in navigation, or affect real users.
// Local review entry:
//   http://localhost:<port>/dev/socialpulse-loader
export default function SocialPulseLoaderPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <Suspense fallback={<div style={{ padding: 40, fontFamily: 'system-ui', color: '#fff', background: '#08081a', minHeight: '100vh' }}>Loading preview…</div>}>
      <LoaderPreviewClient />
    </Suspense>
  );
}
