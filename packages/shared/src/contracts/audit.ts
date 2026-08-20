import { z } from 'zod';
import { uuidSchema } from './common.js';

/** Closed set: an action that is not listed here cannot be written to the log. */
export const auditActionSchema = z.enum([
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DISABLED',
  'USER_REMOVED',
  'PROVIDER_CREATED',
  'PROVIDER_UPDATED',
  'PROVIDER_DELETED',
  'MODEL_CREATED',
  'MODEL_ENABLED',
  'MODEL_DISABLED',
  'MODEL_DELETED',
  'MODEL_ACCESS_UPDATED',
  'API_KEY_CREATED',
  'API_KEY_ROTATED',
  'API_KEY_REVOKED',
  'BUDGET_UPDATED',
  'TEAM_CREATED',
  'TEAM_DELETED',
  'TEAM_MEMBER_ADDED',
  'TEAM_MEMBER_REMOVED',
]);
export type AuditAction = z.infer<typeof auditActionSchema>;

export const auditQuerySchema = z.object({
  action: auditActionSchema.optional(),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const auditEntrySchema = z.object({
  id: z.string(),
  action: auditActionSchema,
  actorUserId: z.string().nullable(),
  targetType: z.string(),
  targetId: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditPageSchema = z.object({
  logs: z.array(auditEntrySchema),
  nextCursor: z.string().nullable(),
});
export type AuditPage = z.infer<typeof auditPageSchema>;
