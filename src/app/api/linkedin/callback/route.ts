import { NextRequest, NextResponse } from 'next/server';
import { storeLinkedInToken } from '../vault';

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || '';
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || '';
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3000/api/linkedin/callback';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL(`/?error=${error}`, request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/?error=no_code', request.url));
  }

  try {
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LINKEDIN_REDIRECT_URI,
        client_id: LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET,
      }),
    });

    if (!tokenResponse.ok) {
      return NextResponse.redirect(new URL('/?error=token_exchange_failed', request.url));
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileResponse.ok) {
      return NextResponse.redirect(new URL('/?error=profile_fetch_failed', request.url));
    }

    const profileData = await profileResponse.json();
    const userId = profileData.sub || '';

    // Store the token server-side only. The browser receives the user id
    // (no access token in URL, storage, or API responses).
    storeLinkedInToken(userId, accessToken);

    const params = new URLSearchParams({
      platform: 'linkedin',
      connected: 'true',
      name: profileData.name || '',
      email: profileData.email || '',
      user_id: userId,
    });

    return NextResponse.redirect(new URL(`/?${params.toString()}`, request.url));
  } catch (error) {
    return NextResponse.redirect(new URL('/?error=callback_failed', request.url));
  }
}
