import type {
  BudgetRow,
  ConnectInfo,
  DateRange,
  DeveloperUsageRow,
  HealthReport,
  UsageBreakdownRow,
  UsageTotals,
} from '@gatehouse/shared';
import { useQuery } from '@tanstack/react-query';
import { api, withRange } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/query-keys';

/** Usage is recomputed by the gateway continuously; a minute of staleness is fine. */
const USAGE_STALE_MS = 60_000;

export function useUsageTotals(range: DateRange = {}) {
  return useQuery({
    queryKey: queryKeys.usage(range),
    queryFn: () => api.get<UsageTotals>(withRange('/api/usage', range)),
    staleTime: USAGE_STALE_MS,
  });
}

export function useUsageByModel(range: DateRange = {}) {
  return useQuery({
    queryKey: queryKeys.usageByModel(range),
    queryFn: () => api.get<UsageBreakdownRow[]>(withRange('/api/usage/models', range)),
    staleTime: USAGE_STALE_MS,
  });
}

export function useUsageByProvider(range: DateRange = {}) {
  return useQuery({
    queryKey: queryKeys.usageByProvider(range),
    queryFn: () => api.get<UsageBreakdownRow[]>(withRange('/api/usage/providers', range)),
    staleTime: USAGE_STALE_MS,
  });
}

export function useUsageByDeveloper(range: DateRange = {}) {
  return useQuery({
    queryKey: queryKeys.usageByDeveloper(range),
    queryFn: () => api.get<DeveloperUsageRow[]>(withRange('/api/usage/developers', range)),
    staleTime: USAGE_STALE_MS,
  });
}

export function useBudgets() {
  return useQuery({ queryKey: queryKeys.budgets, queryFn: () => api.get<BudgetRow[]>('/api/budgets') });
}

export function useConnectInfo() {
  return useQuery({ queryKey: queryKeys.connect, queryFn: () => api.get<ConnectInfo>('/api/connect') });
}

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => api.get<HealthReport>('/ready'),
    // A degraded stack answers 503, which the client treats as an error; report it as data.
    retry: false,
    refetchInterval: 30_000,
  });
}
