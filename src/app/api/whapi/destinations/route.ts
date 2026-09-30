import { NextRequest, NextResponse } from 'next/server';
import { getWhapiConfig, whapiFetch } from '../client';
import { requireApiSession } from '@/lib/auth/api';

// GET /api/whapi/destinations
// One normalized list of everything this channel can publish to:
//   - chats        (1:1 contacts, from /chats type=contact)
//   - groups       (from /chats type=group, unioned with /groups)
//   - communities  (from /communities, resolved to their announcement group)
//
// Communities are returned with their announcementGroupId because Whapi
// rejects sends to a community parent JID (400) — the announce group is the
// only sendable form. Group ids from /chats and /groups are deduped here so
// the same chat never appears twice.

export type DestinationType = 'community' | 'group' | 'chat';

type Raw = {
  id?: string; name?: string; pushname?: string; title?: string; type?: string;
  participants_count?: number; participantsCount?: number;
  is_parent?: boolean; isCommunityAnnounce?: boolean; linkedParent?: string;
};

const CHAT_PAGE = 500;
const CHAT_MAX = 2000;

function label(r: Raw, fallback: string): string {
  return String(r.name || r.pushname || r.title || '').trim() || fallback;
}

export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const config = getWhapiConfig();
  if (!config) {
    return NextResponse.json(
      { success: false, code: 'WHAPI_NOT_CONFIGURED', message: 'Whapi is not configured. Add WHAPI_API_TOKEN to .env.local.' },
      { status: 401 },
    );
  }

  const auth = { Authorization: `Bearer ${config.token}` };
  const getJson = async <T,>(path: string): Promise<{ ok: boolean; data: T | null }> => {
    try {
      const res = await whapiFetch(path, config.token, { method: 'GET' }, config.baseUrl);
      if (!res.ok) return { ok: false, data: null };
      return { ok: true, data: (await res.json().catch(() => null)) as T };
    } catch {
      return { ok: false, data: null };
    }
  };

  try {
    // Groups + communities in parallel; chats paginated after, because a big
    // account has thousands and the extra round-trips are the slow part.
    const [groupsRes, commRes] = await Promise.all([
      getJson<{ groups?: Raw[]; total?: number }>(`/groups?count=500&offset=0`),
      getJson<{ communities?: Raw[] }>('/communities'),
    ]);

    // ---- groups (paginate past the first 500 if needed) ----
    const groupRows: Raw[] = [...(groupsRes.data?.groups ?? [])];
    const groupTotal = typeof groupsRes.data?.total === 'number' ? groupsRes.data.total : groupRows.length;
    for (let offset = groupRows.length; offset < Math.min(groupTotal, CHAT_MAX); offset += 500) {
      const page = await getJson<{ groups?: Raw[] }>(`/groups?count=500&offset=${offset}`);
      const rows = page.data?.groups;
      if (!page.ok || !rows || rows.length === 0) break;
      groupRows.push(...rows);
      if (rows.length < 500) break;
    }

    // ---- communities -> sendable announce group ----
    // Resolve parent -> announce group per community. Sequential-ish with a
    // small cap so a large account cannot stall the whole request.
    const communities: Array<Raw & { announcementGroupId?: string; announcementGroupName?: string }> = [];
    for (const c of (commRes.data?.communities ?? []).slice(0, 100)) {
      if (!c.id) continue;
      let announceId = String(c.id);
      let announceName = '';
      try {
        const sub = await whapiFetch(
          `/communities/${encodeURIComponent(String(c.id))}/subgroups`,
          config.token, { method: 'GET' }, config.baseUrl,
        );
        if (sub.ok) {
          const s = await sub.json().catch(() => ({})) as { announceGroupInfo?: { id?: string; title?: string } };
          if (s.announceGroupInfo?.id) {
            announceId = String(s.announceGroupInfo.id);
            announceName = String(s.announceGroupInfo.title || '');
          }
        }
      } catch { /* fall back to parent id; publish surfaces Whapi's own error */ }
      communities.push({ ...c, announcementGroupId: announceId, announcementGroupName: announceName });
    }

    // ---- chats (1:1 contacts + any group chats not already in /groups) ----
    const chatRows: Raw[] = [];
    let chatTotal = 0;
    for (let offset = 0; offset < CHAT_MAX; offset += CHAT_PAGE) {
      const page = await getJson<{ chats?: Raw[]; total?: number }>(`/chats?count=${CHAT_PAGE}&offset=${offset}`);
      const rows = page.data?.chats;
      if (!page.ok || !rows || rows.length === 0) break;
      chatRows.push(...rows);
      chatTotal = typeof page.data?.total === 'number' ? page.data.total : chatRows.length;
      if (rows.length < CHAT_PAGE) break;
    }

    // ---- merge + dedupe by id, communities win the label ----
    const byId = new Map<string, {
      id: string; name: string; type: DestinationType;
      participantsCount: number; sendId: string;
    }>();

    for (const g of groupRows) {
      if (!g.id) continue;
      const id = String(g.id);
      // Community parents are not sendable on their own.
      if (g.is_parent) continue;
      const isAnnounce = !!g.isCommunityAnnounce;
      byId.set(id, {
        id,
        name: label(g, 'Unnamed Group'),
        type: isAnnounce ? 'community' : 'group',
        participantsCount: g.participants_count ?? g.participantsCount ?? 0,
        sendId: id,
      });
    }

    for (const c of communities) {
      const id = String(c.id);
      const sendId = String(c.announcementGroupId || id);
      const existing = byId.get(sendId);
      const name = label(c, existing?.name ?? 'WhatsApp Community');
      byId.set(id, {
        id,
        name: c.announcementGroupName ? String(c.announcementGroupName) : name,
        type: 'community',
        participantsCount: c.participants_count ?? c.participantsCount ?? 0,
        sendId,
      });
      // Drop the raw announce group entry so a community isn't listed twice.
      if (sendId !== id) byId.delete(sendId);
    }

    for (const ch of chatRows) {
      if (!ch.id) continue;
      const id = String(ch.id);
      if (byId.has(id)) continue; // already covered as a group/community
      const t = String(ch.type || 'contact').toLowerCase();
      if (t === 'group') continue; // group chats live in the groups list
      byId.set(id, {
        id,
        name: label(ch, id.replace(/@(s\.whatsapp\.net|lid|g\.us)$/, '')),
        type: 'chat',
        participantsCount: 0,
        sendId: id,
      });
    }

    const destinations = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      success: true,
      destinations,
      counts: {
        community: destinations.filter((d) => d.type === 'community').length,
        group: destinations.filter((d) => d.type === 'group').length,
        chat: destinations.filter((d) => d.type === 'chat').length,
        total: destinations.length,
        chatsTotalAtProvider: chatTotal,
      },
    });
  } catch (e) {
    console.error('[whapi/destinations] failure:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { success: false, code: 'WHAPI_DESTINATIONS_FAILED', message: 'Network error loading WhatsApp destinations.' },
      { status: 502 },
    );
  }
}
