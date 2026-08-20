import { z } from 'zod';
import { uuidSchema } from './common.js';

export const createTeamRequestSchema = z.object({ name: z.string().min(1).max(80) });
export type CreateTeamRequest = z.infer<typeof createTeamRequestSchema>;

export const addTeamMemberRequestSchema = z.object({ userId: uuidSchema });
export type AddTeamMemberRequest = z.infer<typeof addTeamMemberRequestSchema>;

export const teamSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  memberCount: z.number().int(),
});
export type TeamSummary = z.infer<typeof teamSummarySchema>;

export const teamDetailSchema = teamSummarySchema.extend({
  members: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })),
  models: z.array(z.object({ id: z.string(), publicModelName: z.string() })),
});
export type TeamDetail = z.infer<typeof teamDetailSchema>;
