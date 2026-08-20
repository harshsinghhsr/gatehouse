import { z } from 'zod';
import { passwordSchema } from './auth.js';
import { budgetPeriodSchema, keyStatusSchema, roleSchema, userStatusSchema, uuidSchema } from './common.js';

export const budgetSettingsSchema = z.object({
  maxBudget: z.number().positive().max(1_000_000),
  period: budgetPeriodSchema,
  rpmLimit: z.number().int().positive().max(100_000).nullish(),
  tpmLimit: z.number().int().positive().max(100_000_000).nullish(),
});
export type BudgetSettings = z.infer<typeof budgetSettingsSchema>;

export const createDeveloperRequestSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(120),
  /** Only needed if this person also signs into the dashboard. */
  password: passwordSchema.optional(),
  role: roleSchema.exclude(['OWNER']).default('MEMBER'),
});
export type CreateDeveloperRequest = z.infer<typeof createDeveloperRequestSchema>;

export const updateDeveloperRequestSchema = z
  .object({
    status: userStatusSchema.optional(),
    role: roleSchema.optional(),
    budget: budgetSettingsSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');
export type UpdateDeveloperRequest = z.infer<typeof updateDeveloperRequestSchema>;

export const setModelAccessRequestSchema = z.object({ modelIds: z.array(uuidSchema).max(200) });
export type SetModelAccessRequest = z.infer<typeof setModelAccessRequestSchema>;

export const developerSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  status: userStatusSchema,
  role: roleSchema,
  activeKeys: z.number().int(),
});
export type DeveloperSummary = z.infer<typeof developerSummarySchema>;

export const gatewayKeySchema = z.object({
  id: z.string(),
  keyAlias: z.string(),
  /** Masked for display, e.g. "sk-abc…WXYZ". The secret itself is never stored. */
  keyPrefix: z.string().nullable(),
  status: keyStatusSchema,
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
});
export type GatewayKey = z.infer<typeof gatewayKeySchema>;

export const developerDetailSchema = developerSummarySchema.extend({
  models: z.array(z.object({ id: z.string(), publicModelName: z.string() })),
  budget: budgetSettingsSchema.nullable(),
  spend: z.number().nullable(),
  teams: z.array(z.object({ id: z.string(), name: z.string() })),
  keys: z.array(gatewayKeySchema),
});
export type DeveloperDetail = z.infer<typeof developerDetailSchema>;

/** The only response that ever carries a plaintext key, and only at the moment it is minted. */
export const issuedKeySchema = z.object({
  id: z.string(),
  key: z.string(),
  keyPrefix: z.string().nullable(),
});
export type IssuedKey = z.infer<typeof issuedKeySchema>;
