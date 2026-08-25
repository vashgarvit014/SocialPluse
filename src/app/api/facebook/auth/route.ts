import { NextRequest, NextResponse } from 'next/server';

const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';
const FACEBOOK_REDIRECT_URI = 'http://localhost:3000/api/facebook/callback';

export async function GET(request: NextRequest) {
  const scope = 'pages_manage_posts,pages_read_engagement,public_profile,email';
  const state = Math.random().toString(36).substring(7);
  
  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
    `client_id=${FACEBOOK_APP_ID}&` +
    `redirect_uri=${encodeURIComponent(FACEBOOK_REDIRECT_URI)}&` +
    `scope=${scope}&` +
    `response_type=code&` +
    `state=${state}`;

  return NextResponse.redirect(authUrl);
}
