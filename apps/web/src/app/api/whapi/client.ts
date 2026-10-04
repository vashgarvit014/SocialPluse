// Provider client moved to services/integrations-service and services/publishing-service.
export interface WhapiApiError { code: string; message: string }
export function getWhapiConfig(): null { return null; }
export function whapiError(status: number, _body: string, context: string): WhapiApiError {
  return { code: 'WHAPI_MOVED_TO_SERVICE', message: `Whapi request during ${context} must go through integrations-service (status ${status}).` };
}
export async function whapiFetch(_path?: string, _token?: string, _init?: RequestInit, _baseUrl?: string): Promise<Response> {
  return new Response(JSON.stringify({ code: 'WHAPI_MOVED_TO_SERVICE' }), { status: 410, headers: { 'content-type': 'application/json' } });
}
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length <= 4 ? '••••' : `••••••${digits.slice(-4)}`;
}
