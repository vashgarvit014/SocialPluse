import { startReturn } from '@/lib/oauth-return';
import { NextRequest, NextResponse } from 'next/server';

const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';
const FACEBOOK_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:3001/api/facebook/callback';
// "Facebook Login for Business" (Use cases > Facebook Login for Business >
// Configurations) - a Configuration bundles the permission set (below) plus
// the access-token type (User access token, matching this app's per-user
// login model) into one config_id. Business-asset permissions - Instagram
// specifically - could NOT be requested as a raw `scope=` string through
// this product no matter what they were named: both instagram_basic/
// instagram_content_publish and their renamed instagram_business_basic/
// instagram_business_content_publish versions came back "Invalid Scopes"
// from Meta's OAuth dialog even after being added and shown "Ready for
// testing" under Instagram API's own permissions list - that list governs
// Standard Access, not what this specific login product will accept in the
// URL directly. config_id is the actual mechanism Facebook Login for
// Business requires; discovered by working through the App Dashboard's
// Facebook Login for Business > Configurations flow. The Configuration
// itself has pages_show_list, pages_read_engagement, pages_manage_posts,
// instagram_business_basic and instagram_business_content_publish selected,
// so no separate `scope` param is sent (or needed) here - the config_id
// carries them all.
const FACEBOOK_LOGIN_CONFIG_ID = process.env.FACEBOOK_LOGIN_CONFIG_ID || '';

export async function GET(request: NextRequest) {
  if (!FACEBOOK_APP_ID) {
    return NextResponse.json(
      { error: { code: 'FACEBOOK_NOT_CONFIGURED', message: 'Facebook App ID is not configured. Add FACEBOOK_APP_ID to .env.local.' } },
      { status: 500 },
    );
  }
  if (!FACEBOOK_LOGIN_CONFIG_ID) {
    return NextResponse.json(
      { error: { code: 'FACEBOOK_NOT_CONFIGURED', message: 'FACEBOOK_LOGIN_CONFIG_ID is not configured. Add it to .env.local (App Dashboard > Facebook Login for Business > Configurations).' } },
      { status: 500 },
    );
  }
  const state = Math.random().toString(36).substring(2) + Date.now().toString(36);
  const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?` +
    `client_id=${FACEBOOK_APP_ID}&` +
    `redirect_uri=${encodeURIComponent(FACEBOOK_REDIRECT_URI)}&` +
    `config_id=${encodeURIComponent(FACEBOOK_LOGIN_CONFIG_ID)}&` +
    `response_type=code&` +
    `state=${state}`;
  return startReturn(request, NextResponse.redirect(authUrl), state);
}
