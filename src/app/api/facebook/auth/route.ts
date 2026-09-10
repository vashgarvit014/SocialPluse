import { NextResponse } from 'next/server';

const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';
const FACEBOOK_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:3001/api/facebook/callback';

// Page publishing needs a Page token, which requires these Login permissions.
// They work for app admins/developers while the app is in dev mode (no App
// Review needed to post to your own Page); review is only required before
// opening the integration to other users.
const SCOPES = ['public_profile', 'pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];

export async function GET() {
  if (!FACEBOOK_APP_ID) {
    return NextResponse.json(
      { error: { code: 'FACEBOOK_NOT_CONFIGURED', message: 'Facebook App ID is not configured. Add FACEBOOK_APP_ID to .env.local.' } },
      { status: 500 },
    );
  }
  const state = Math.random().toString(36).substring(2) + Date.now().toString(36);
  const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?` +
    `client_id=${FACEBOOK_APP_ID}&` +
    `redirect_uri=${encodeURIComponent(FACEBOOK_REDIRECT_URI)}&` +
    `scope=${encodeURIComponent(SCOPES.join(','))}&` +
    `response_type=code&` +
    `state=${state}`;
  return NextResponse.redirect(authUrl);
}
