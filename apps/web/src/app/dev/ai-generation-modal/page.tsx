import { notFound } from 'next/navigation';
import PreviewClient from './preview-client';

// DEVELOPMENT ONLY. In production builds this route answers 404, so the
// preview can never ship, appear in navigation, or affect real users.
// Local review entry:
//   http://localhost:<port>/dev/ai-generation-modal
export default function AIGenerationModalPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <PreviewClient />;
}
