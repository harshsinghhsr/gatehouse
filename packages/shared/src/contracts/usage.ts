import { z } from 'zod';
import { budgetPeriodSchema } from './common.js';

/** Every figure originates in LiteLLM. The control plane never recomputes a token price. */

export const usageTotalsSchema = z.object({
  range: z.object({ from: z.string(), to: z.string() }),
  spend: z.number(),
  requests: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  activeDevelopers: z.number().int(),
  activeModels: z.number().int(),
  daily: z.array(z.object({ date: z.string(), spend: z.number(), requests: z.number() })),
});
export type UsageTotals = z.infer<typeof usageTotalsSchema>;

export const usageBreakdownRowSchema = z.object({
  name: z.string(),
  spend: z.number(),
  requests: z.number(),
});
export type UsageBreakdownRow = z.infer<typeof usageBreakdownRowSchema>;

export const developerUsageRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  spend: z.number(),
  requests: z.number(),
});
export type DeveloperUsageRow = z.infer<typeof developerUsageRowSchema>;

export const budgetRowSchema = z.object({
  id: z.string(),
  maxBudget: z.number(),
  period: budgetPeriodSchema,
  rpmLimit: z.number().int().nullable(),
  holder: z.object({ kind: z.enum(['developer', 'team']), id: z.string(), name: z.string(), email: z.string().nullable() }),
});
export type BudgetRow = z.infer<typeof budgetRowSchema>;

export const connectInfoSchema = z.object({
  openai: z.object({ baseUrl: z.string() }),
  anthropic: z.object({ baseUrl: z.string() }),
  models: z.array(z.string()),
  keys: z.array(z.object({ id: z.string(), keyPrefix: z.string().nullable(), createdAt: z.string() })),
});
export type ConnectInfo = z.infer<typeof connectInfoSchema>;

export const healthReportSchema = z.object({
  status: z.enum(['ready', 'degraded']),
  services: z.record(z.string(), z.enum(['ok', 'down'])),
});
export type HealthReport = z.infer<typeof healthReportSchema>;
