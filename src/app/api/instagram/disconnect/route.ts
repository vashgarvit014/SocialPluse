import { NextResponse } from 'next/server';

// Instagram has no credentials of its own to revoke here - it's derived
// live from the connected Facebook Page's linked Instagram Business account
// (see facebook/vault's getInstagramAccount). "Disconnecting" Instagram from
// this app just means the frontend stops selecting it as a publish target;
// it does not and should not touch the Facebook connection, which the user
// may still want. The actual unlink happens on Meta's side (Meta Business
// Suite) if that's what's intended.
export async function POST() {
  return NextResponse.json({ success: true });
}
