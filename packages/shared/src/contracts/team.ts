import { z } from 'zod';
import { teamRoleSchema, uuidSchema } from './common.js';

export const createTeamRequestSchema = z.object({ name: z.string().min(1).max(80) });
export type CreateTeamRequest = z.infer<typeof createTeamRequestSchema>;

export const addTeamMemberRequestSchema = z.object({
  userId: uuidSchema,
  role: teamRoleSchema.default('MEMBER'),
});
export type AddTeamMemberRequest = z.infer<typeof addTeamMemberRequestSchema>;

const teamBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  memberCount: z.number().int(),
});

/**
 * `viewerRole` is the caller's own role in this team, or null when they do not belong to it.
 * The list is readable by every member, but who may manage a team is a per-team fact, so the
 * row carries it rather than the client guessing from the instance role alone.
 */
export const teamSummarySchema = teamBaseSchema.extend({
  viewerRole: teamRoleSchema.nullable(),
});
export type TeamSummary = z.infer<typeof teamSummarySchema>;

export const teamDetailSchema = teamBaseSchema.extend({
  members: z.array(
    z.object({ id: z.string(), name: z.string(), email: z.string(), role: teamRoleSchema }),
  ),
  models: z.array(z.object({ id: z.string(), publicModelName: z.string() })),
});
export type TeamDetail = z.infer<typeof teamDetailSchema>;

/**
 * The Add-member picker, and nothing more. A team lead may read this, so it carries no budget,
 * grant, key, role or status — only what is needed to name a person in a dropdown.
 */
export const teamCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});
export type TeamCandidate = z.infer<typeof teamCandidateSchema>;
