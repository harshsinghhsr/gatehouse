import { z } from 'zod';
import { providerStatusSchema, providerTypeSchema } from './common.js';

/** Credential values are write-only: they appear in requests and never in responses. */
const credentialValuesSchema = z.record(z.string(), z.string().min(1).max(4000));
const configValuesSchema = z.record(z.string(), z.string().max(500));

export const createProviderRequestSchema = z.object({
  name: z.string().min(1).max(80),
  type: providerTypeSchema,
  credentials: credentialValuesSchema,
  config: configValuesSchema.default({}),
});
export type CreateProviderRequest = z.infer<typeof createProviderRequestSchema>;

export const updateProviderRequestSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    status: providerStatusSchema.optional(),
    credentials: credentialValuesSchema.optional(),
    config: configValuesSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');
export type UpdateProviderRequest = z.infer<typeof updateProviderRequestSchema>;

export const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: providerTypeSchema,
  displayName: z.string(),
  status: providerStatusSchema,
  config: configValuesSchema,
  modelCount: z.number().int(),
  lastTestedAt: z.string().nullable(),
  lastTestError: z.string().nullable(),
});
export type Provider = z.infer<typeof providerSchema>;

export const providerTypeInfoSchema = z.object({
  type: providerTypeSchema,
  displayName: z.string(),
  credentialFields: z.array(z.object({ name: z.string(), label: z.string() })),
  configFields: z.array(
    z.object({ name: z.string(), label: z.string(), required: z.boolean(), placeholder: z.string().nullable() }),
  ),
});
export type ProviderTypeInfo = z.infer<typeof providerTypeInfoSchema>;

export const providerTestResultSchema = z.object({ ok: z.literal(true), models: z.array(z.string()) });
export type ProviderTestResult = z.infer<typeof providerTestResultSchema>;
