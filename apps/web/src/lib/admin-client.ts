import 'server-only';
import { callGateway } from './gateway-client';

export type AdminServiceResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; data: null };

export async function callAdminService<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<AdminServiceResult<T>> {
  return callGateway<T>(`/api/admin${path}`, init);
}
