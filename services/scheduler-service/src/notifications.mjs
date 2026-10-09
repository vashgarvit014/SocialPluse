// User-facing notifications, written to admin_notifications with user_id set.
//
// That table is the app's single notification mechanism (its Superadmin bell
// already renders rows with user_id IS NULL). Scheduled-publishing outcomes
// write rows with user_id set, which the new user-facing notification route
// reads back. No second notification table, no second delivery path.
//
// Messages are plain user-facing copy. Never pass tokens, credentials, or
// provider payloads — the logger refuses forbidden keys, but this module
// writes straight to the database, so the caller is responsible.

const CATEGORIES = {
  SCHEDULED_POST_PUBLISHED: 'INFO',
  SCHEDULED_POST_PARTIAL_SUCCESS: 'WARNING',
  SCHEDULED_POST_FAILED: 'WARNING',
  PLATFORM_CONNECTION_REQUIRED: 'WARNING',
  PLATFORM_RECONNECTED: 'INFO',
  SCHEDULE_RETRY_SUCCESS: 'INFO',
  SCHEDULE_RETRY_FAILED: 'WARNING',
};

export function createNotifier(pool, log) {
  async function notify({ userId, type, title, message, metadata = {} }) {
    if (!userId) return null;
    const severity = CATEGORIES[type] || 'INFO';
    const category = type.startsWith('PLATFORM_') ? 'PLATFORM' : 'PUBLISHING';
    try {
      const { rows } = await pool.query(
        `INSERT INTO admin_notifications (id, type, category, severity, title, message, user_id, is_read, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, now())
         RETURNING id`,
        [crypto.randomUUID(), type, category, severity, title, message, userId, JSON.stringify(metadata)],
      );
      log?.info({ event: 'notification_created', userId, notificationType: type });
      return rows[0]?.id || null;
    } catch (e) {
      // A notification failure must never fail the publish itself.
      log?.warn({ event: 'notification_failed', userId, notificationType: type, message: e instanceof Error ? e.message : 'unknown' });
      return null;
    }
  }

  return { notify };
}
