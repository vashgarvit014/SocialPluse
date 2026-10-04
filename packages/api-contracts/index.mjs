// Shared API contracts (Zod schemas). Services validate against these
// instead of trusting each other's shape implicitly. Pure data shapes only -
// no business logic belongs in this package.

import { z } from 'zod';

export const AiUsageStatsDTO = z.object({
  contentGenerations: z.number(),
  imageGenerations: z.number(),
  failedGenerations: z.number(),
  todayRequests: z.number(),
  hasData: z.boolean(),
  dailyCounts: z.array(z.object({ date: z.string(), count: z.number() })),
  providers: z.array(z.object({
    provider: z.string(),
    type: z.enum(['CONTENT', 'IMAGE']),
    total: z.number(),
    failed: z.number(),
  })),
});

// Matches media-service's toPublicAsset() output exactly — storageKey/
// thumbnailKey are server-internal and deliberately never part of this
// shape (see media-assets.mjs's own comment on why that stripping happens
// in one place rather than per-route).
export const MediaAssetDTO = z.object({
  id: z.string(),
  userId: z.string(),
  filename: z.string(),
  originalFilename: z.string(),
  type: z.enum(['image', 'video']),
  mime: z.string(),
  size: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  durationMs: z.number().nullable(),
  source: z.string(),
  altText: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string(),
  deletedAt: z.string().nullable(),
});

// Body shape for media-service's internal, service-to-service create path
// (POST /internal/assets) — what ai-service/integrations-service/
// publishing-service will send once cut over to it.
export const CreateMediaAssetRequestDTO = z.object({
  userId: z.string(),
  filename: z.string(),
  mime: z.string(),
  bytesBase64: z.string(),
  source: z.string().optional(),
  altText: z.string().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  durationMs: z.number().nullable().optional(),
});

export const UploadResponseDTO = z.object({
  uploaded: z.array(z.object({ id: z.string(), filename: z.string(), type: z.string(), mime: z.string(), size: z.number(), source: z.string(), createdAt: z.string(), expiresAt: z.string() })),
  failed: z.array(z.object({ filename: z.string(), error: z.string() })),
});

export const MediaListResponseDTO = z.object({
  assets: z.array(MediaAssetDTO.partial({ userId: true })), // userId omitted on the Superadmin ?all=1 view
});

export const HealthResponseDTO = z.object({
  service: z.string(),
  status: z.enum(['ok', 'degraded']),
  timestamp: z.string(),
});

// user-service DTOs (Phase 8). Matches users.ts#toUser exactly — never
// password_hash/otp/session-token fields, there's nothing to accidentally
// leak here even by omission-mistake.
export const UserProfileDTO = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  mobile: z.string().nullable(),
  emailVerifiedAt: z.string().nullable(),
  mobileVerifiedAt: z.string().nullable(),
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED']),
  role: z.enum(['SUPERADMIN', 'USER']),
  lastLoginAt: z.string().nullable(),
  mustSetPassword: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const UserAccountStatusDTO = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED']),
});

export const ModerationStateDTO = z.object({
  violationCount: z.number(),
  flagged: z.boolean(),
  flagReason: z.string().nullable(),
  flaggedAt: z.string().nullable(),
  firstViolationAt: z.string().nullable(),
  lastViolationAt: z.string().nullable(),
  latestDecision: z.string().nullable(),
  latestMethod: z.string().nullable(),
  latestEventAt: z.string().nullable(),
  severity: z.enum(['WARNING', 'HIGH', 'CRITICAL']),
});
