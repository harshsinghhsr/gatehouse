import type { CreateModelRequest, Model } from '@gatehouse/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/query-keys';

export function useModels() {
  return useQuery({ queryKey: queryKeys.models, queryFn: () => api.get<Model[]>('/api/models') });
}

/** Any model mutation can change what a provider shows and what developers may call. */
function useModelMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.models }),
        queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.developers }),
      ]),
  });
}

export const useCreateModel = () =>
  useModelMutation((body: CreateModelRequest) => api.post<Model>('/api/models', body));

export const useSetModelEnabled = () =>
  useModelMutation((variables: { id: string; enabled: boolean }) =>
    api.patch<Model>(`/api/models/${variables.id}`, { enabled: variables.enabled }),
  );

export const useDeleteModel = () => useModelMutation((id: string) => api.delete<void>(`/api/models/${id}`));
