// Type-only mirror of apps/web's src/lib/system-log.ts#SystemLogRow — no
// 'server-only', no DB import. Only the shape admin-service's GET /logs
// response already matches is needed here.
export type SystemLogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
export type SystemLogCategory = 'AUTH' | 'USER' | 'AI' | 'MEDIA' | 'PUBLISHING' | 'PLATFORM' | 'SYSTEM';

export interface SystemLogRow {
  id: string;
  createdAt: string;
  level: SystemLogLevel;
  category: SystemLogCategory;
  event: string;
  userId: string | null;
  userEmail: string | null;
  platform: string | null;
  resourceId: string | null;
  message: string;
  metadata: Record<string, string | number | boolean | null> | null;
  requestId: string | null;
}
