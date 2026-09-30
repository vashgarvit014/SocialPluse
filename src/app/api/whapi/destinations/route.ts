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
// /groups?count=500 is intermittently reset by Whapi (ECONNRESET), which used
// to silently yield an empty group list. 100 is reliable and only costs one
// extra sequential page on a large account.
const GROUP_PAGE = 100;
const GROUP_MAX = 2000;
// Announcement-group lookups are independent reads, but Whapi rate-limits, so
// they run 4 at a time rather than all at once.
const SUBGROUP_CONCURRENCY = 4;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { at: number; body: unknown } | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Whapi answers a single read in 8-16s and intermittently drops large pages, so
// every read gets a bounded retry with backoff on 429/5xx/network errors.
async function getJson<T>(
  path: string,
  config: { token: string; baseUrl: string },
  attempts = 3,
): Promise<{ ok: boolean; data: T | null }> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await whapiFetch(path, config.token, { method: 'GET' }, config.baseUrl);
      if (res.status === 429 || res.status >= 500) {
        if (i < attempts - 1) { await sleep(700 * Math.pow(2, i)); continue; }
        return { ok: false, data: null };
      }
      if (!res.ok) return { ok: false, data: null };
      return { ok: true, data: (await res.json().catch(() => null)) as T };
    } catch {
      if (i < attempts - 1) { await sleep(500 * Math.pow(2, i)); continue; }
      return { ok: false, data: null };
    }
  }
  return { ok: false, data: null };
}

// Bounded-concurrency map. Collapses what were sequential round-trips without
// firing everything at a rate-limited provider at once.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

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

  const force = request.nextUrl.searchParams.get('refresh') === '1';
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.body);
  }

  try {
    const loadGroups = async (): Promise<Raw[]> => {
      const rows: Raw[] = [];
      let total = 0;
      for (let offset = 0; offset < GROUP_MAX; offset += GROUP_PAGE) {
        const page = await getJson<{ groups?: Raw[]; total?: number }>(
          `/groups?count=${GROUP_PAGE}&offset=${offset}`, config,
        );
        const got = page.data?.groups;
        if (!page.ok || !got || got.length === 0) break;
        rows.push(...got);
        total = typeof page.data?.total === 'number' ? page.data.total : rows.length;
        if (got.length < GROUP_PAGE) break;
      }
      return rows;
    };

    const loadChats = async (): Promise<{ rows: Raw[]; total: number }> => {
      const rows: Raw[] = [];
      let total = 0;
      for (let offset = 0; offset < CHAT_MAX; offset += CHAT_PAGE) {
        const page = await getJson<{ chats?: Raw[]; total?: number }>(
          `/chats?count=${CHAT_PAGE}&offset=${offset}`, config,
        );
        const got = page.data?.chats;
        if (!page.ok || !got || got.length === 0) break;
        rows.push(...got);
        total = typeof page.data?.total === 'number' ? page.data.total : rows.length;
        if (got.length < CHAT_PAGE) break;
      }
      return { rows, total };
    };

    // Groups, communities and chats are independent, so they all start now.
    // Previously chats waited behind every community's subgroup lookup, adding
    // its ~15s to the end of an already long request.
    const groupsPromise = loadGroups();
    const commPromise = getJson<{ communities?: Raw[] }>('/communities', config);
    const chatsPromise = loadChats();

    // Communities are needed before announcement groups can be resolved, but
    // that resolution no longer blocks the chat pagination.
    const commRes = await commPromise;
    const communitiesPromise = mapLimit<Raw & { announcementGroupId?: string; announcementGroupName?: string }, void>(
      (commRes.data?.communities ?? []).slice(0, 100),
      SUBGROUP_CONCURRENCY,
      async (c) => {
        if (!c.id) return;
        const sub = await getJson<{ announceGroupInfo?: { id?: string; title?: string } }>(
          `/communities/${encodeURIComponent(String(c.id))}/subgroups`, config, 2,
        );
        const info = sub.data?.announceGroupInfo;
        c.announcementGroupId = info?.id ? String(info.id) : String(c.id);
        c.announcementGroupName = info?.title ? String(info.title) : '';
      },
    );

    const [groupRows, chats, communitiesRaw] = await Promise.all([
      groupsPromise, chatsPromise, communitiesPromise.then(() => (commRes.data?.communities ?? [])),
    ]);
    const communities = (communitiesRaw as Array<Raw & { announcementGroupId?: string; announcementGroupName?: string }>).slice(0, 100);
    const chatRows = chats.rows;
    const chatTotal = chats.total;

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

    const body = {
      success: true,
      destinations,
      counts: {
        community: destinations.filter((d) => d.type === 'community').length,
        group: destinations.filter((d) => d.type === 'group').length,
        chat: destinations.filter((d) => d.type === 'chat').length,
        total: destinations.length,
        chatsTotalAtProvider: chatTotal,
      },
    };
    // Re-opening the picker should not re-pay ~1min of provider round-trips.
    // Only cache a complete result: a partial one (e.g. /groups dropped) would
    // otherwise be served for the whole TTL.
    const complete = groupRows.length > 0 && chats.rows.length > 0;
    if (complete) cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    console.error('[whapi/destinations] failure:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { success: false, code: 'WHAPI_DESTINATIONS_FAILED', message: 'Network error loading WhatsApp destinations.' },
      { status: 502 },
    );
  }
}
