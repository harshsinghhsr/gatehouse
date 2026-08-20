import type { AuditAction, AuditPage } from '@gatehouse/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/query-keys';

export function useAuditLogs(action?: AuditAction) {
  return useQuery({
    queryKey: queryKeys.auditLogs(action),
    queryFn: () => api.get<AuditPage>(`/api/audit-logs${action ? `?action=${action}` : ''}`),
  });
}
