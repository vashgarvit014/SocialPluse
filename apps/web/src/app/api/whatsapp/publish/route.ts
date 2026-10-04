import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { publishWhatsAppMessage } from '@/lib/whatsapp-service';
import { requireApiActor } from '@/lib/internal-auth';

export async function POST(request: NextRequest) {
  // Accepts EITHER a signed-in browser or the publish worker's signed
  // assertion; a session alone would 401 the cookie-less worker call and
  // silently fail every scheduled post.
  const actor = await requireApiActor(request);
  if (actor instanceof NextResponse) return actor;
  const body = await request.json().catch(() => ({}));
  const response = await publishWhatsAppMessage({
    communityId: body.communityId,
    announcementGroupId: body.announcementGroupId || body.groupId || body.pageId,
    text: body.text || body.content,
    mediaList: body.mediaList,
    attemptId: body.attemptId,
  });
  if (response.ok) return response;

  const data = await response.json().catch(() => ({}));
  const code = typeof data.code === 'string' ? data.code : 'WHATSAPP_PUBLISH_FAILED';
  const message =
    // Prefer the server's specific reason; the old single sentence claimed a
    // "Community" was missing even when the user had picked a chat or simply
    // sent a stale id, which sent people hunting for a group they never chose.
    code === 'WHAPI_GROUP_NOT_FOUND' ? (typeof data.message === 'string' && data.message ? data.message
      : 'That WhatsApp destination is no longer available. Refresh the destination list and choose again.') :
    code === 'WHAPI_TRIAL_LIMIT' ? 'This WhatsApp connection cannot publish to that community yet. Please contact your SocialPulse admin.' :
    code === 'WHAPI_UNAUTHORIZED' ? 'WhatsApp connection needs attention. Reconnect and try again.' :
    code === 'WHATSAPP_NOT_CHANNEL_OWNER' ? (typeof data.message === 'string' && data.message ? data.message
      : 'This WhatsApp number is connected to a different SocialPulse account.') :
    code === 'WHAPI_UNSUPPORTED_MEDIA' ? 'This media type is not supported for WhatsApp publishing yet.' :
    code === 'WHAPI_PERMISSION_DENIED' ? (typeof data.message === 'string' && data.message ? data.message : 'You are not an admin of this announcement group — only admins can post there. Choose a regular group or make this number an admin.') :
    code === 'WHAPI_COMMUNITY_PARENT' ? (typeof data.message === 'string' && data.message ? data.message : 'This chat cannot receive messages directly. Select its announcement group instead.') :
    code === 'WHAPI_BAD_REQUEST' ? (typeof data.message === 'string' && data.message ? data.message : 'WhatsApp could not publish this post. Check the chat and message.') :
    'WhatsApp could not publish this post. Please try again.';
  return NextResponse.json({ success: false, code, message, attemptId: data.attemptId }, { status: response.status });
}
