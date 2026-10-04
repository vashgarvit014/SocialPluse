// Minimal port of the handful of src/lib/admin-host.ts exports otp/verify
// actually needs for its post-login redirect (public-host visitors land on
// the admin console's own origin, not a same-origin "/superadmin" that
// 404s on the public site). The rest of admin-host.ts (isSuperadminHost,
// path helpers) is proxy.ts/page-routing concern, not auth logic — not
// duplicated here.
export const SUPERADMIN_HOSTNAME = (process.env.SUPERADMIN_HOSTNAME || 'supersocialpulse.dotstark.tech').trim().toLowerCase();
export const SUPERADMIN_ORIGIN = (process.env.SUPERADMIN_ORIGIN || `https://${SUPERADMIN_HOSTNAME}`).replace(/\/$/, '');

function hostSet(raw, fallback) {
  return new Set((raw || fallback).split(',').map(h => h.trim().toLowerCase()).filter(Boolean));
}
const PUBLIC_HOSTS = hostSet(process.env.PUBLIC_APP_HOSTNAMES, 'socialpulse.dotstark.tech');

export function normalizeHost(hostHeader) {
  return (hostHeader || '').split(':')[0].trim().toLowerCase();
}
export function isPublicHost(host) {
  return PUBLIC_HOSTS.has(normalizeHost(host));
}
