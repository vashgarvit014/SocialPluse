import { NextResponse } from 'next/server';
import { getWhatsAppConfig, waFetch } from '../client';

// Quick connectivity check - confirms WHATSAPP_PHONE_NUMBER_ID/ACCESS_TOKEN
// are actually valid together, before anything tries to create a group.
// Same "live-verify, don't just check env vars are non-empty" pattern as
// facebook/status and linkedin/status.
export async function GET() {
  const config = getWhatsAppConfig();
  if (!config) return NextResponse.json({ connected: false, reason: 'NOT_CONFIGURED' });

  try {
    const res = await waFetch(`/${config.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, config.accessToken);
    if (!res.ok) {
      return NextResponse.json({ connected: false, reason: 'INVALID_CREDENTIALS' });
    }
    const data = await res.json();
    return NextResponse.json({
      connected: true,
      phoneNumber: data.display_phone_number || '',
      verifiedName: data.verified_name || '',
      qualityRating: data.quality_rating || '',
    });
  } catch {
    return NextResponse.json({ connected: false, reason: 'NETWORK_ERROR' });
  }
}
