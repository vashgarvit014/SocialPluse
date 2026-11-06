import 'server-only';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://gateway:8080';

export async function proxyToGateway(request: Request, path?: string, options: { streamBody?: boolean } = {}): Promise<Response> {
  const url = new URL(request.url);
  const targetPath = path || `${url.pathname}${url.search}`;
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? (options.streamBody ? request.body : await request.arrayBuffer()) : undefined;

  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  const contentType = request.headers.get('content-type');
  const requestId = request.headers.get('x-request-id');
  if (cookie) headers.set('cookie', cookie);
  if (contentType) headers.set('content-type', contentType);
  for (const name of ['content-range', 'content-length', 'range']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (requestId) headers.set('x-request-id', requestId);

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    body,
    cache: 'no-store',
    redirect: 'manual',
  };
  if (options.streamBody && hasBody) init.duplex = 'half';
  const upstream = await fetch(`${GATEWAY_URL}${targetPath}`, init);

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!['content-encoding', 'set-cookie'].includes(key.toLowerCase())) responseHeaders.set(key, value);
  });
  const setCookies = typeof (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (upstream.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
    : [];
  for (const cookieValue of setCookies) responseHeaders.append('set-cookie', cookieValue);

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}
