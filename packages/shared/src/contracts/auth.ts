import { z } from 'zod';
import { roleSchema, userStatusSchema } from './common.js';

/** Long enough to be worth hashing; the limit keeps a megabyte of "password" out of scrypt. */
export const passwordSchema = z.string().min(12, 'Use at least 12 characters').max(200);
export const emailSchema = z.string().email().max(255);

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const registerRequestSchema = z.object({
  email: emailSchema,
  name: z.string().min(1).max(120),
  password: passwordSchema,
  organizationName: z.string().min(1).max(120),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  status: userStatusSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const organizationSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: roleSchema,
});
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const meResponseSchema = z.object({
  user: sessionUserSchema,
  role: roleSchema,
  activeOrganizationId: z.string(),
  organizations: z.array(organizationSummarySchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const loginResponseSchema = z.object({ user: sessionUserSchema });
export type LoginResponse = z.infer<typeof loginResponseSchema>;
