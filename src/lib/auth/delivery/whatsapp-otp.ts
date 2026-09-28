import 'server-only';

// Deliberately separate from src/app/api/whapi/* and src/lib/whatsapp-service.ts
// (both Whapi, used for existing WhatsApp group/community publishing) and
// from src/app/api/whatsapp/client.ts (Meta Cloud API, but scoped to the
// group-messaging number). Authentication OTP delivery gets its own Meta
// WhatsApp Business number/app and its own approved Authentication template
// — see META_WHATSAPP_* env vars. Do not point these at the group number or
// route OTPs through Whapi.
function getConfig() {
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN;
  const templateName = process.env.META_WHATSAPP_OTP_TEMPLATE_NAME;
  const templateLanguage = process.env.META_WHATSAPP_TEMPLATE_LANGUAGE || 'en_US';
  const apiVersion = process.env.META_WHATSAPP_API_VERSION || 'v21.0';
  if (!phoneNumberId || !accessToken || !templateName) return null;
  return { phoneNumberId, accessToken, templateName, templateLanguage, graph: `https://graph.facebook.com/${apiVersion}` };
}

export async function sendWhatsAppOtp(params: { to: string; otp: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = getConfig();
  if (!config) return { ok: false, error: 'WhatsApp delivery is not configured.' };

  // Meta requires the recipient number without the leading '+'.
  const to = params.to.replace(/^\+/, '');

  // Meta's Authentication template category expects the code as a body
  // variable and, for the standard "copy code" button, the same code again
  // as the button parameter. If your approved template's component layout
  // differs (e.g. a "one-tap autofill" button, or no button at all), adjust
  // this payload to match what's actually approved in the Meta app — the
  // template name/language are already externalized via env vars, but the
  // component shape itself is inherent to whichever template got approved.
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: config.templateName,
      language: { code: config.templateLanguage },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: params.otp }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: params.otp }] },
      ],
    },
  };

  try {
    const res = await fetch(`${config.graph}/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.accessToken}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[auth/whatsapp-otp] delivery failed (${res.status}):`, text.slice(0, 500));
      return { ok: false, error: 'Unable to send the verification code through WhatsApp. Please try again or use Email.' };
    }
    return { ok: true };
  } catch (error) {
    console.error('[auth/whatsapp-otp] delivery failed:', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Unable to send the verification code through WhatsApp. Please try again or use Email.' };
  }
}
