import type {
  CreateProviderRequest,
  Provider,
  ProviderTestResult,
  ProviderTypeInfo,
} from '@gatehouse/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/query-keys';

/** Provider detail carries its models, which the list view does not need. */
export type ProviderDetail = Provider;

export function useProviders() {
  return useQuery({ queryKey: queryKeys.providers, queryFn: () => api.get<Provider[]>('/api/providers') });
}

export function useProvider(id: string) {
  return useQuery({
    queryKey: queryKeys.provider(id),
    queryFn: () => api.get<ProviderDetail>(`/api/providers/${id}`),
  });
}

export function useProviderTypes() {
  return useQuery({
    queryKey: queryKeys.providerTypes,
    queryFn: () => api.get<ProviderTypeInfo[]>('/api/provider-types'),
    // The catalog only changes when the platform is upgraded.
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useCreateProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProviderRequest) => api.post<Provider>('/api/providers', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
  });
}

export function useTestProvider(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ProviderTestResult>(`/api/providers/${id}/test`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.provider(id) }),
  });
}

export function useDeleteProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/providers/${id}`),
    // Deleting a provider takes its models with it.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.models }),
      ]),
  });
}
