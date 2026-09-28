import 'server-only';
import { getAnyFacebookAuth } from '@/app/api/facebook/vault';
import { getAnyLinkedInToken } from '@/app/api/linkedin/vault';
import { getWhapiConfig } from '@/app/api/whapi/client';
import { loadPosts } from '@/lib/post-store';

// System-wide, not per-user: SocialPulse has exactly one connected account
// per platform for the whole tool (see the vault modules' own comments —
// "single-user local tool, not multi-tenant"), so a per-USER connections
// view would be fabricated. This reads the same on-disk vaults the app
// already uses to publish — no live provider API calls, matching the
// System Health page's "don't call external APIs just to render a page" rule.
export type ConnectionState = 'CONNECTED' | 'NOT_CONNECTED' | 'NOT_TRACKABLE';

export interface ConnectionStatus {
  name: string;
  status: ConnectionState;
  account: string | null;
  detail: string;
  lastPublishAt: string | null;
}

function lastPublishFor(platform: string): string | null {
  const posts = loadPosts().filter(p => p.status === 'published' && (p.platforms || []).includes(platform));
  if (!posts.length) return null;
  return posts.reduce<string | null>((latest, p) => {
    const t = p.updatedAt || null;
    return t && (!latest || t > latest) ? t : latest;
  }, null);
}

export function getConnectionsOverview(): ConnectionStatus[] {
  const fb = getAnyFacebookAuth();
  const igPages = (fb?.pages || []).filter(p => p.instagramUsername);
  const li = getAnyLinkedInToken();
  const whapi = getWhapiConfig();

  return [
    {
      name: 'Facebook',
      status: fb ? 'CONNECTED' : 'NOT_CONNECTED',
      account: fb ? fb.pages.map(p => p.name).join(', ') : null,
      detail: fb ? `${fb.pages.length} page${fb.pages.length === 1 ? '' : 's'} linked` : 'No account connected',
      lastPublishAt: lastPublishFor('facebook'),
    },
    {
      name: 'Instagram',
      status: igPages.length ? 'CONNECTED' : 'NOT_CONNECTED',
      account: igPages.map(p => p.instagramUsername).join(', ') || null,
      detail: igPages.length ? `${igPages.length} linked Business account${igPages.length === 1 ? '' : 's'}` : 'No linked Instagram Business account',
      lastPublishAt: lastPublishFor('instagram'),
    },
    {
      name: 'LinkedIn',
      status: li ? 'CONNECTED' : 'NOT_CONNECTED',
      account: null,
      detail: li ? 'Account token present' : 'No account connected',
      lastPublishAt: lastPublishFor('linkedin'),
    },
    {
      name: 'Whapi (WhatsApp groups)',
      status: whapi ? 'CONNECTED' : 'NOT_CONNECTED',
      account: null,
      detail: whapi ? 'Token configured' : 'WHAPI_API_TOKEN not set',
      lastPublishAt: lastPublishFor('whatsapp'),
    },
    {
      name: 'Canva',
      status: 'NOT_TRACKABLE',
      account: null,
      detail: 'Canva tokens live only in the connecting browser’s cookies and are never persisted server-side — Superadmin has no way to see this status.',
      lastPublishAt: null,
    },
  ];
}
