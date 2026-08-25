import { NextRequest, NextResponse } from 'next/server';

const INSTAGRAM_CLIENT_ID = process.env.INSTAGRAM_CLIENT_ID || '';
const INSTAGRAM_REDIRECT_URI = 'http://localhost:3000/api/instagram/callback';

export async function GET(request: NextRequest) {
  const scope = 'user_profile,user_media';
  const state = Math.random().toString(36).substring(7);
  
  const authUrl = `https://api.instagram.com/oauth/authorize?` +
    `client_id=${INSTAGRAM_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(INSTAGRAM_REDIRECT_URI)}&` +
    `scope=${scope}&` +
    `response_type=code&` +
    `state=${state}`;

  return NextResponse.redirect(authUrl);
}
