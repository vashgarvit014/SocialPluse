import 'server-only';
import { cookies } from 'next/headers';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://gateway:8080';

export type GatewayResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; data: null };

function buildCookieHeader(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return cookieStore.getAll().map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

export async function callGateway<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<GatewayResult<T>> {
  try {
    const cookieStore = await cookies();
    const res = await fetch(`${GATEWAY_URL}${path}`, {
      method: init.method || 'GET',
      headers: {
        cookie: buildCookieHeader(cookieStore),
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
      redirect: 'manual',
    });
    if (!res.ok) return { ok: false, status: res.status, data: null };
    return { ok: true, status: res.status, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export async function proxyToGateway(request: Request, path?: string): Promise<Response> {
  const url = new URL(request.url);
  const targetPath = path || `${url.pathname}${url.search}`;
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  const contentType = request.headers.get('content-type');
  if (cookie) headers.set('cookie', cookie);
  if (contentType) headers.set('content-type', contentType);

  const upstream = await fetch(`${GATEWAY_URL}${targetPath}`, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    cache: 'no-store',
    redirect: 'manual',
  });

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!['content-encoding', 'set-cookie'].includes(key.toLowerCase())) responseHeaders.set(key, value);
  });
  const setCookies = typeof (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (upstream.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
    : [];
  for (const cookieValue of setCookies) responseHeaders.append('set-cookie', cookieValue);
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: responseHeaders });
}
