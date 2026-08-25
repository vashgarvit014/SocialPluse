import { NextRequest, NextResponse } from 'next/server';

const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';
const FACEBOOK_REDIRECT_URI = 'http://localhost:3000/api/facebook/callback';

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
    const tokenResponse = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(FACEBOOK_REDIRECT_URI)}&client_secret=${FACEBOOK_APP_SECRET}&code=${code}`
    );

    if (!tokenResponse.ok) {
      return NextResponse.redirect(new URL('/?error=token_exchange_failed', request.url));
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    const profileResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`
    );

    if (!profileResponse.ok) {
      return NextResponse.redirect(new URL('/?error=profile_fetch_failed', request.url));
    }

    const profileData = await profileResponse.json();

    const params = new URLSearchParams({
      platform: 'facebook',
      connected: 'true',
      name: profileData.name || '',
      email: profileData.email || '',
      access_token: accessToken,
      user_id: profileData.id || '',
    });

    return NextResponse.redirect(new URL(`/?${params.toString()}`, request.url));
  } catch (error) {
    return NextResponse.redirect(new URL('/?error=callback_failed', request.url));
  }
}
