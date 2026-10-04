// Faithful port of src/lib/auth/delivery/whatsapp-otp.ts — the OFFICIAL
// Meta WhatsApp Cloud API, its own number/app/approved Authentication
// template (META_WHATSAPP_*). Deliberately separate from Whapi (used
// elsewhere for social/community publishing only) — per this round's
// explicit instruction, auth OTP must never go through Whapi.
export function getConfig() {
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN;
  const templateName = process.env.META_WHATSAPP_OTP_TEMPLATE_NAME;
  const templateLanguage = process.env.META_WHATSAPP_TEMPLATE_LANGUAGE || 'en_US';
  const apiVersion = process.env.META_WHATSAPP_API_VERSION || 'v21.0';
  if (!phoneNumberId || !accessToken || !templateName) return null;
  return { phoneNumberId, accessToken, templateName, templateLanguage, graph: `https://graph.facebook.com/${apiVersion}` };
}

export async function sendWhatsAppOtp({ to, otp }) {
  const config = getConfig();
  if (!config) return { ok: false, error: 'WhatsApp delivery is not configured.' };
  const recipient = to.replace(/^\+/, '');
  const body = {
    messaging_product: 'whatsapp', to: recipient, type: 'template',
    template: {
      name: config.templateName, language: { code: config.templateLanguage },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: otp }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: otp }] },
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
