import { z } from 'zod';

/**
 * The wire contract between the API and the web client. Both sides import these schemas,
 * so a change to a payload is a compile error on the other side rather than a runtime surprise.
 * Nothing here may import from an app, an ORM, or a provider SDK.
 */

export const roleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
export type Role = z.infer<typeof roleSchema>;

export const userStatusSchema = z.enum(['ACTIVE', 'DISABLED']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const providerTypeSchema = z.enum(['AZURE_OPENAI', 'OPENAI', 'ANTHROPIC']);
export type ProviderType = z.infer<typeof providerTypeSchema>;

export const providerStatusSchema = z.enum(['ACTIVE', 'DISABLED']);
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

export const keyStatusSchema = z.enum(['ACTIVE', 'REVOKED', 'ROTATED']);
export type KeyStatus = z.infer<typeof keyStatusSchema>;

export const budgetPeriodSchema = z.enum(['DAILY', 'MONTHLY']);
export type BudgetPeriod = z.infer<typeof budgetPeriodSchema>;

export const uuidSchema = z.string().uuid();
export const idParamSchema = z.object({ id: uuidSchema });
export type IdParam = z.infer<typeof idParamSchema>;

export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const dateRangeSchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type DateRange = z.infer<typeof dateRangeSchema>;

/** Every failure the API returns has this shape. */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const okSchema = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof okSchema>;
