import 'server-only';
import { query, queryOne } from '@/lib/db';

// Superadmin notification queue.
//
// This table is the notification SYSTEM. The Cloudflare tunnel in front of the
// app is transport only and takes no part in alerting: nothing is pushed
// through it, and no tunnel configuration decides who gets told.

export type NotificationSeverity = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';

export interface AdminNotification {
  id: string;
  type: string;
  category: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  userId: string | null;
  userName?: string | null;
  userEmail?: string | null;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
}

interface Row {
  id: string;
  type: string;
  category: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
}

function hydrate(r: Row): AdminNotification {
  return {
    id: r.id,
    type: r.type,
    category: r.category,
    severity: r.severity,
    title: r.title,
    message: r.message,
    userId: r.user_id,
    userName: r.user_name,
    userEmail: r.user_email,
    isRead: r.is_read,
    createdAt: r.created_at,
    readAt: r.read_at,
  };
}

export async function listNotifications(opts: { unreadOnly?: boolean; limit?: number } = {}): Promise<AdminNotification[]> {
  const rows = await query<Row>(
    `SELECT n.id, n.type, n.category, n.severity, n.title, n.message, n.user_id,
            n.is_read, n.created_at, n.read_at,
            u.name AS user_name, u.email AS user_email
       FROM admin_notifications n
       LEFT JOIN users u ON u.id = n.user_id
      ${opts.unreadOnly ? 'WHERE n.is_read = false' : ''}
      ORDER BY n.created_at DESC
      LIMIT $1`,
    [opts.limit ?? 50],
  );
  return rows.map(hydrate);
}

export async function unreadCount(): Promise<number> {
  const row = await queryOne<{ count: string }>(
    'SELECT count(*) AS count FROM admin_notifications WHERE is_read = false',
  );
  return Number(row?.count || 0);
}

export async function markRead(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE admin_notifications SET is_read = true, read_at = $2
      WHERE id = $1 AND is_read = false RETURNING id`,
    [id, new Date().toISOString()],
  );
  return rows.length > 0;
}

export async function markAllRead(): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE admin_notifications SET is_read = true, read_at = $2
      WHERE is_read = false RETURNING id`,
    [new Date().toISOString()],
  );
  return rows.length;
}
