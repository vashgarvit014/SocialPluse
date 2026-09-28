import 'server-only';
import { randomUUID } from 'node:crypto';
import { query } from '@/lib/db';

export type SystemLogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
export type SystemLogCategory = 'AUTH' | 'USER' | 'AI' | 'MEDIA' | 'PUBLISHING' | 'PLATFORM' | 'SYSTEM';

export interface SystemLogFields {
  level: SystemLogLevel;
  category: SystemLogCategory;
  event: string;
  userId?: string;
  userEmail?: string;
  platform?: string;
  resourceId?: string;
  message: string;
  metadata?: Record<string, string | number | boolean | null>;
  requestId?: string;
}

export interface SystemLogRow extends Required<Pick<SystemLogFields, 'level' | 'category' | 'event' | 'message'>> {
  id: string;
  createdAt: string;
  userId: string | null;
  userEmail: string | null;
  platform: string | null;
  resourceId: string | null;
  metadata: Record<string, string | number | boolean | null> | null;
  requestId: string | null;
}

// Keys that must never reach the logs table, even nested inside metadata.
const SENSITIVE_KEY = /(password|passwd|pwd|secret|token|otp|passcode|cookie|session|authorization|api[_-]?key|access[_-]?key|private[_-]?key|DATABASE_URL)/i;
// Bearer tokens / long hex-or-base64 blobs accidentally pasted into messages.
const SECRET_VALUE = /Bearer\s+[A-Za-z0-9._~+/-]+=*|(?<![A-Za-z0-9])(?:[A-Za-z0-9+/]{32,}={0,2}|[a-f0-9]{32,})(?![A-Za-z0-9])/g;

export function sanitizeLogValue(input: string): string {
  return input.replace(SECRET_VALUE, '[redacted]').slice(0, 2000);
}

function sanitizeMetadata(meta: Record<string, string | number | boolean | null> | undefined): Record<string, string | number | boolean | null> | null {
  if (!meta) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = '[redacted]';
    } else if (typeof v === 'string') {
      out[k] = sanitizeLogValue(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Fire-and-forget, same contract as logAuthEvent/ai-usage: a lost log row
// must never fail or delay the request it describes.
export function logSystem(fields: SystemLogFields): void {
  query(
    `INSERT INTO system_logs (id, created_at, level, category, event, user_id, user_email, platform, resource_id, message, metadata, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      randomUUID(),
      new Date().toISOString(),
      fields.level,
      fields.category,
      fields.event.slice(0, 120),
      fields.userId || null,
      fields.userEmail || null,
      fields.platform || null,
      fields.resourceId || null,
      sanitizeLogValue(fields.message),
      fields.metadata ? JSON.stringify(sanitizeMetadata(fields.metadata)) : null,
      fields.requestId || null,
    ],
  ).catch((error) => {
    console.error('[system-log] failed to write row:', error instanceof Error ? error.message : 'unknown error');
  });
}
