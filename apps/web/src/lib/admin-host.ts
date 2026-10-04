import 'server-only';

// Host routing for the Superadmin surface.
//
// The admin UI is served from its own subdomain so it can never be confused
// with the public product site. Two facts about the request host drive
// everything in src/proxy.ts:
//
//   isAdminHost(h)  the admin subdomain — full admin surface, "/" IS the login
//   isPublicHost(h) the public product site — /superadmin* does not exist here
//
// isPublicHost is the DENY list and isAdminHost the ALLOW list, and they are
// deliberately defined independently rather than as opposites. Local
// development (localhost:3000) matches NEITHER, which keeps the admin console
// reachable during development while production public traffic gets a 404.

/** Hostname that serves the Superadmin console. */
export const SUPERADMIN_HOSTNAME =
  (process.env.SUPERADMIN_HOSTNAME || 'supersocialpulse.dotstark.tech').trim().toLowerCase();

/**
 * Absolute origin of the admin console. Only used when an admin signs in on
 * the PUBLIC site, where /superadmin is 404 — they have to be handed off to
 * the host that actually serves the console.
 */
export const SUPERADMIN_ORIGIN =
  (process.env.SUPERADMIN_ORIGIN || `https://${SUPERADMIN_HOSTNAME}`).replace(/\/$/, '');

/** Comma-separated in PUBLIC_APP_HOSTNAMES for extra public domains. */
function hostSet(raw: string | undefined, fallback: string): Set<string> {
  return new Set(
    (raw || fallback)
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

const SUPERADMIN_HOSTS = hostSet(process.env.SUPERADMIN_HOSTNAMES, SUPERADMIN_HOSTNAME);
const PUBLIC_HOSTS = hostSet(process.env.PUBLIC_APP_HOSTNAMES, 'socialpulse.dotstark.tech');

/** Strips the port and lowercases; Cloudflare sets Host to what was requested. */
export function normalizeHost(hostHeader: string | null | undefined): string {
  return (hostHeader || '').split(':')[0].trim().toLowerCase();
}

export function isSuperadminHost(host: string | null | undefined): boolean {
  return SUPERADMIN_HOSTS.has(normalizeHost(host));
}

export function isPublicHost(host: string | null | undefined): boolean {
  return PUBLIC_HOSTS.has(normalizeHost(host));
}

/** True for `/superadmin` and anything beneath it. */
export function isSuperadminPath(pathname: string): boolean {
  return pathname === '/superadmin' || pathname.startsWith('/superadmin/');
}

/**
 * The raw, un-normalised pathname from a request URL.
 *
 * Next.js collapses duplicate slashes and strips a trailing slash BEFORE the
 * proxy runs, answering those forms with a 308 to the canonical path. That
 * meant `/superadmin/`, `/superadmin//` and `//superadmin` all bounced with a
 * redirect instead of 404-ing, so the URL still answered. Reading the URL
 * directly recovers the form the visitor actually asked for.
 */
export function rawPathname(url: string): string {
  const schemeEnd = url.indexOf('://');
  const afterScheme = schemeEnd >= 0 ? url.slice(url.indexOf('/', schemeEnd + 3)) : url;
  const q = afterScheme.indexOf('?');
  const path = q >= 0 ? afterScheme.slice(0, q) : afterScheme;
  return path || '/';
}

/**
 * Canonical form used for matching: duplicate slashes collapsed, `/./`
 * resolved, a trailing slash dropped and percent-escapes decoded. Decoding can
 * throw on malformed input, so it falls back to the undecoded path rather than
 * letting a crafted URL break the request.
 */
export function canonicalPathname(pathname: string): string {
  let p = pathname.replace(/\/{2,}/g, '/').replace(/\/\.(?=\/|$)/g, '');
  if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep the raw form */
  }
  return p.toLowerCase();
}