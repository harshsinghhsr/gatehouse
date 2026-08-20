import type { DateRange } from '@gatehouse/shared';

/**
 * One source of truth for cache keys, so an invalidation after a mutation cannot miss a
 * screen that happens to read the same data.
 */
export const queryKeys = {
  session: ['session'] as const,
  health: ['health'] as const,

  providers: ['providers'] as const,
  provider: (id: string) => ['providers', id] as const,
  providerTypes: ['provider-types'] as const,

  models: ['models'] as const,

  developers: ['developers'] as const,
  developer: (id: string) => ['developers', id] as const,

  teams: ['teams'] as const,
  team: (id: string) => ['teams', id] as const,

  usage: (range: DateRange) => ['usage', range] as const,
  usageByModel: (range: DateRange) => ['usage', 'models', range] as const,
  usageByProvider: (range: DateRange) => ['usage', 'providers', range] as const,
  usageByDeveloper: (range: DateRange) => ['usage', 'developers', range] as const,

  budgets: ['budgets'] as const,
  connect: ['connect'] as const,
  auditLogs: (action?: string) => ['audit-logs', action ?? 'all'] as const,
};
