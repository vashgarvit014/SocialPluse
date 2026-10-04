import 'server-only';

// apps/superadmin's equivalent of the gateway's proxyToService, scoped to
// auth-service only. Forwards the Cookie header (pending-auth/session) and
// relays every Set-Cookie back untouched — same two bugs already fixed
// once in the gateway (redirect:'manual', headers.getSetCookie() instead
// of .forEach()) are avoided here from the start.
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:4011';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

export async function proxyToAuthService(request: Request, path: string): Promise<Response> {
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const bodyText = hasBody ? await request.text() : undefined;

  const upstream = await fetch(`${AUTH_SERVICE_URL}${path}`, {
    method: request.method,
    headers: {
      'content-type': request.headers.get('content-type') || 'application/json',
      cookie: request.headers.get('cookie') || '',
      'x-internal-secret': INTERNAL_SECRET,
    },
    body: bodyText,
    redirect: 'manual',
  });

  const buf = Buffer.from(await upstream.arrayBuffer());
  const headers = new Headers();
  upstream.headers.forEach((v, k) => {
    if (!['content-encoding', 'set-cookie'].includes(k.toLowerCase())) headers.set(k, v);
  });
  const setCookies = upstream.headers.getSetCookie ? upstream.headers.getSetCookie() : [];
  for (const c of setCookies) headers.append('set-cookie', c);

  return new Response(buf, { status: upstream.status, headers });
}
