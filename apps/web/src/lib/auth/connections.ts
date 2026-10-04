import 'server-only';
import { listAllConnections } from '@/lib/platform-connections';
import { getWhapiConfig } from '@/app/api/whapi/client';
import { listAllPosts } from '@/lib/post-store';

// Cross-user, Superadmin-only. This is the ONE place allowed to enumerate
// every account's platform connections, and it is reached exclusively through
// requireApiSuperadmin()-gated routes / pages.
//
// It previously called getAnyFacebookAuth() / getAnyLinkedInToken(), which
// returned "whichever connection was established most recently" and therefore
// could not even answer the question correctly once more than one user
// existed. Connections are now per-user rows, so this can report accurately
// how many accounts have each platform connected.
//
// Still system-wide, and deliberately so: a real per-USER connections view
// belongs to /connect-platforms, which reads each user's own rows.
export type ConnectionState = 'CONNECTED' | 'NOT_CONNECTED' | 'NOT_TRACKABLE';

export interface ConnectionStatus {
  name: string;
  status: ConnectionState;
  account: string | null;
  detail: string;
  lastPublishAt: string | null;
  /** How many distinct users have this platform connected. */
  connectedUsers: number;
}

async function lastPublishFor(platform: string): Promise<string | null> {
  const posts = await listAllPosts();
  const published = posts.filter(p => p.status === 'published' && (p.platforms || []).includes(platform));
  if (!published.length) return null;
  return published.reduce<string | null>((latest, p) => {
    const t = p.updatedAt || null;
    return t && (!latest || t > latest) ? t : latest;
  }, null);
}

function summarise(platform: string, connections: Awaited<ReturnType<typeof listAllConnections>>) {
  const rows = connections.filter(c => c.platform === platform);
  const users = new Set(rows.map(r => r.userId));
  return { rows, users: users.size };
}

export async function getConnectionsOverview(): Promise<ConnectionStatus[]> {
  const connections = await listAllConnections();
  const whapi = getWhapiConfig();

  const fb = summarise('facebook', connections);
  const ig = summarise('facebook', connections); // Instagram rides on the Facebook Page token
  const li = summarise('linkedin', connections);
  const canva = summarise('canva', connections);

  const fbNames = fb.rows
    .map(r => {
      const pages = r.meta?.pageCount;
      return `${r.displayName || r.providerUserId}${typeof pages === 'number' ? ` (${pages} page${pages === 1 ? '' : 's'})` : ''}`;
    })
    .slice(0, 5)
    .join(', ');

  return [
    {
      name: 'Facebook',
      status: fb.users > 0 ? 'CONNECTED' : 'NOT_CONNECTED',
      account: fbNames || null,
      detail: fb.users > 0 ? `${fb.users} user${fb.users === 1 ? '' : 's'} connected` : 'No account connected',
      lastPublishAt: await lastPublishFor('facebook'),
      connectedUsers: fb.users,
    },
    {
      name: 'Instagram',
      // Derived from the same Facebook connection rows, so it tracks fb.users.
      status: ig.users > 0 ? 'CONNECTED' : 'NOT_CONNECTED',
      account: ig.rows.map(r => r.displayName).filter(Boolean).slice(0, 5).join(', ') || null,
      detail: ig.users > 0 ? `${ig.users} user${ig.users === 1 ? '' : 's'} linked via a Facebook Page` : 'No linked Instagram Business account',
      lastPublishAt: await lastPublishFor('instagram'),
      connectedUsers: ig.users,
    },
    {
      name: 'LinkedIn',
      status: li.users > 0 ? 'CONNECTED' : 'NOT_CONNECTED',
      account: li.rows.map(r => r.displayName || r.email).filter(Boolean).slice(0, 5).join(', ') || null,
      detail: li.users > 0 ? `${li.users} user${li.users === 1 ? '' : 's'} connected` : 'No account connected',
      lastPublishAt: await lastPublishFor('linkedin'),
      connectedUsers: li.users,
    },
    {
      name: 'Whapi (WhatsApp groups)',
      status: whapi ? 'CONNECTED' : 'NOT_CONNECTED',
      account: null,
      detail: whapi ? 'Token configured (server-wide, not per-user)' : 'WHAPI_API_TOKEN not set',
      lastPublishAt: await lastPublishFor('whatsapp'),
      connectedUsers: whapi ? 1 : 0,
    },
    {
      name: 'Canva',
      status: canva.users > 0 ? 'CONNECTED' : 'NOT_TRACKABLE',
      account: canva.rows.map(r => r.displayName).filter(Boolean).slice(0, 5).join(', ') || null,
      detail: canva.users > 0
        ? `${canva.users} user${canva.users === 1 ? '' : 's'} connected`
        : 'Canva credentials live only in the connecting browser’s cookies and are never persisted server-side — Superadmin has no way to see this status.',
      lastPublishAt: null,
      connectedUsers: canva.users,
    },
  ];
}