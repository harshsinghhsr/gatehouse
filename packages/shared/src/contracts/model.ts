import { z } from 'zod';
import { providerTypeSchema, uuidSchema } from './common.js';

/** The public name becomes a model id developers type, so keep it to identifier characters. */
export const publicModelNameSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dots, dashes, or underscores');

export const createModelRequestSchema = z.object({
  providerId: uuidSchema,
  publicModelName: publicModelNameSchema,
  providerModelName: z.string().min(1).max(200),
});
export type CreateModelRequest = z.infer<typeof createModelRequestSchema>;

export const updateModelRequestSchema = z.object({ enabled: z.boolean() });
export type UpdateModelRequest = z.infer<typeof updateModelRequestSchema>;

export const modelSchema = z.object({
  id: z.string(),
  publicModelName: z.string(),
  providerModelName: z.string(),
  /** Namespaced name inside the gateway: "{orgSlug}/{publicModelName}". */
  gatewayModelName: z.string(),
  enabled: z.boolean(),
  provider: z.object({ id: z.string(), name: z.string(), type: providerTypeSchema }),
});
export type Model = z.infer<typeof modelSchema>;
