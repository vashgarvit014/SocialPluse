import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import PreviewClient from './client';

// DEVELOPMENT ONLY. In production builds this route answers 404, so it can
// never ship or affect real users. Local review entry:
//   http://localhost:30019/local-preview?step=2        (open Step 2 directly)
//   http://localhost:30019/local-preview?step=3        (Step 3 idle/content)
//   http://localhost:30019/local-preview?step=3&gen=1  (Step 3 generating)
//   http://localhost:30019/local-preview?step=4        (Step 4)
export default function LocalPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <Suspense fallback={<div style={{ padding: 40, fontFamily: 'system-ui' }}>Loading preview…</div>}>
      <PreviewClient />
    </Suspense>
  );
}
