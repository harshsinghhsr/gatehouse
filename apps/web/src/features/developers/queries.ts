import type {
  CreateDeveloperRequest,
  DeveloperDetail,
  DeveloperSummary,
  IssuedKey,
  SetModelAccessRequest,
  UpdateDeveloperRequest,
} from '@gatehouse/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/query-keys';

export function useDevelopers() {
  return useQuery({
    queryKey: queryKeys.developers,
    queryFn: () => api.get<DeveloperSummary[]>('/api/developers'),
  });
}

export function useDeveloper(id: string) {
  return useQuery({
    queryKey: queryKeys.developer(id),
    queryFn: () => api.get<DeveloperDetail>(`/api/developers/${id}`),
  });
}

function useDeveloperMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  developerId?: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.developers }),
        developerId
          ? queryClient.invalidateQueries({ queryKey: queryKeys.developer(developerId) })
          : Promise.resolve(),
        queryClient.invalidateQueries({ queryKey: queryKeys.budgets }),
      ]),
  });
}

export const useCreateDeveloper = () =>
  useDeveloperMutation((body: CreateDeveloperRequest) =>
    api.post<DeveloperSummary>('/api/developers', body),
  );

export const useUpdateDeveloper = (id: string) =>
  useDeveloperMutation(
    (body: UpdateDeveloperRequest) => api.patch<{ ok: true }>(`/api/developers/${id}`, body),
    id,
  );

export const useSetDeveloperModels = (id: string) =>
  useDeveloperMutation(
    (body: SetModelAccessRequest) => api.put<{ models: unknown[] }>(`/api/developers/${id}/models`, body),
    id,
  );

/** The response carries the plaintext key. It is shown once and never refetched. */
export const useIssueKey = (id: string) =>
  useDeveloperMutation(() => api.post<IssuedKey>(`/api/developers/${id}/keys`), id);

export const useRotateKey = (id: string) =>
  useDeveloperMutation(
    (keyId: string) => api.post<IssuedKey>(`/api/developers/${id}/keys/${keyId}/rotate`),
    id,
  );

export const useRevokeKey = (id: string) =>
  useDeveloperMutation(
    (keyId: string) => api.post<{ ok: true }>(`/api/developers/${id}/keys/${keyId}/revoke`),
    id,
  );
