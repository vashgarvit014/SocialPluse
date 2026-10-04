import { redirect } from 'next/navigation';
import SocialMediaManager from '@/app/_shell/social-media-manager';

// This path is Canva integration's registered "Return URL" (Return
// navigation, in the developer portal) - Canva sends the browser here with
// ?correlation_jwt=... once the user finishes editing. All the actual work
// (verify the JWT, mark the design ready to import) lives in
// /api/canva/return; a request carrying that param is relayed there
// unchanged, exactly as the old /content-studio/route.ts did. Any other
// request (a person actually opening Content Studio) renders the app.
export default async function ContentStudioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (typeof params.correlation_jwt === 'string') {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') qs.set(key, value);
    }
    redirect(`/api/canva/return?${qs.toString()}`);
  }

  return <SocialMediaManager initialTab="studio" />;
}
