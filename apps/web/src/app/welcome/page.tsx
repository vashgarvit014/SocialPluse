import { redirect } from 'next/navigation';

// The landing page now lives at / (see src/app/page.tsx, which renders the
// same LandingClient this page used to). Keep this route only so old
// /welcome links/bookmarks still land somewhere sensible.
export default function WelcomePage() {
  redirect('/');
}
