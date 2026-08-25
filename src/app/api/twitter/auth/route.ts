import { NextRequest, NextResponse } from 'next/server';

const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || '';
const TWITTER_REDIRECT_URI = 'http://localhost:3000/api/twitter/callback';

export async function GET(request: NextRequest) {
  const scope = 'tweet.read tweet.write users.read offline.access';
  const state = Math.random().toString(36).substring(7);
  
  const authUrl = `https://twitter.com/i/oauth2/authorize?` +
    `response_type=code&` +
    `client_id=${TWITTER_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(TWITTER_REDIRECT_URI)}&` +
    `scope=${encodeURIComponent(scope)}&` +
    `state=${state}&` +
    `code_challenge=challenge&` +
    `code_challenge_method=plain`;

  return NextResponse.redirect(authUrl);
}
