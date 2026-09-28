import { NextRequest, NextResponse } from 'next/server';
import { getWhapiConfig, whapiFetch, whapiError } from '../client';
import { requireApiSession } from '@/lib/auth/api';

// GET /api/whapi/groups — existing WhatsApp groups only via Whapi
// Uses official Whapi endpoint GET https://gate.whapi.cloud/groups?count=100&offset=0
// Returns normalized list: [{ id, name, participantsCount, type }]

function notConfigured() {
  return NextResponse.json(
    { success: false, code: 'WHAPI_NOT_CONFIGURED', message: 'Whapi is not configured. Add WHAPI_API_TOKEN to .env.local.' },
    { status: 401 }
  );
}

export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const config = getWhapiConfig();
  if (!config) return notConfigured();

  const countParam = request.nextUrl.searchParams.get('count');
  const count = countParam ? Math.min(500, Math.max(1, parseInt(countParam, 10) || 100)) : 100;
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get('offset') || '0', 10) || 0);

  try {
    // Official Whapi groups endpoint
    const res = await whapiFetch(`/groups?count=${count}&offset=${offset}`, config.token, { method: 'GET' }, config.baseUrl);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const mapped = whapiError(res.status, body, 'fetching groups');
      const code = res.status === 401 ? 'WHAPI_UNAUTHORIZED' : 'WHAPI_GROUPS_FETCH_FAILED';
      return NextResponse.json({ success: false, code, message: mapped.message }, { status: res.status === 401 ? 401 : 502 });
    }

    const data = await res.json().catch(() => ({})) as {
      groups?: Array<{
        id?: string;
        name?: string;
        participants_count?: number;
        participantsCount?: number;
        type?: string;
        participants?: unknown[];
        isCommunityAnnounce?: boolean;
        is_parent?: boolean;
        linkedParent?: string;
      }>;
      total?: number;
      count?: number;
      offset?: number;
    };

    const rawGroups = Array.isArray(data.groups) ? data.groups : [];

    // Normalize: existing WhatsApp groups only, filter type === group
    // Do NOT fabricate; only return what Whapi returns
    // Type mapping: group, announcement, community handling per spec
    const normalized = rawGroups
      .filter(g => g && typeof g.id === 'string' && g.id.length > 0)
      .filter(g => {
        // Keep only group-like chats; Whapi groups endpoint should already be groups
        // But be defensive: if type is present and not group/announcement, skip
        const t = (g.type || 'group').toLowerCase();
        return t === 'group' || t === 'announcement' || t === 'unknown' || !g.type;
      })
      .map(g => {
        const id = String(g.id);
        const name = String(g.name || 'Unnamed Group');
        // participantsCount may be participants_count or derived from participants array
        let participantsCount: number | undefined;
        if (typeof g.participants_count === 'number') participantsCount = g.participants_count;
        else if (typeof (g as Record<string, unknown>).participantsCount === 'number') participantsCount = (g as { participantsCount: number }).participantsCount;
        else if (Array.isArray(g.participants)) participantsCount = g.participants.length;

        // Community detection: is_parent, isCommunityAnnounce etc
        let type: 'group' | 'announcement_group' | 'community' = 'group';
        if (g.isCommunityAnnounce) type = 'announcement_group';
        else if (g.is_parent) type = 'community';

        return {
          id,
          name,
          participantsCount: participantsCount ?? 0,
          type,
          // Keep raw community metadata separate per spec
          isParent: !!g.is_parent,
          isCommunityAnnounce: !!g.isCommunityAnnounce,
          linkedParent: g.linkedParent || undefined,
        };
      });

    // Never expose unrelated personal chats — groups endpoint already scoped,
    // but ensure we don't leak participant phone numbers etc.
    // Only return minimal fields; strip participants array

    return NextResponse.json({
      success: true,
      groups: normalized.map(g => ({
        id: g.id,
        name: g.name,
        participantsCount: g.participantsCount,
        type: g.type,
        // expose community flags for UI typing
        ...(g.type !== 'group' ? { isParent: g.isParent, isCommunityAnnounce: g.isCommunityAnnounce, linkedParent: g.linkedParent } : {}),
      })),
      count: normalized.length,
      total: typeof data.total === 'number' ? data.total : normalized.length,
      offset,
    });
  } catch (e) {
    console.error('[whapi/groups] network failure:', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, code: 'WHAPI_GROUPS_FETCH_FAILED', message: 'Network error fetching Whapi groups.' }, { status: 502 });
  }
}
