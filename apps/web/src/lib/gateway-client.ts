import 'server-only';
import { cookies } from 'next/headers';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://gateway:8080';

export type GatewayResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; data: null };

export async function callGateway<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<GatewayResult<T>> {
  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.getAll().map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    const res = await fetch(`${GATEWAY_URL}${path}`, {
      method: init.method || 'GET',
      headers: {
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, status: res.status, data: null };
    return { ok: true, status: res.status, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
