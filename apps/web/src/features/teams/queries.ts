import type { CreateTeamRequest, SetModelAccessRequest, TeamDetail, TeamSummary } from '@gatehouse/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/query-keys';

export function useTeams() {
  return useQuery({ queryKey: queryKeys.teams, queryFn: () => api.get<TeamSummary[]>('/api/teams') });
}

export function useTeam(id: string | null) {
  return useQuery({
    queryKey: queryKeys.team(id ?? 'none'),
    queryFn: () => api.get<TeamDetail>(`/api/teams/${id}`),
    enabled: id !== null,
  });
}

/** Team changes can alter what members may call, so developer views are invalidated too. */
function useTeamMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  teamId?: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.teams }),
        teamId ? queryClient.invalidateQueries({ queryKey: queryKeys.team(teamId) }) : Promise.resolve(),
        queryClient.invalidateQueries({ queryKey: queryKeys.developers }),
      ]),
  });
}

export const useCreateTeam = () =>
  useTeamMutation((body: CreateTeamRequest) => api.post<TeamSummary>('/api/teams', body));

export const useDeleteTeam = () => useTeamMutation((id: string) => api.delete<void>(`/api/teams/${id}`));

export const useAddTeamMember = (teamId: string) =>
  useTeamMutation((userId: string) => api.post(`/api/teams/${teamId}/members`, { userId }), teamId);

export const useRemoveTeamMember = (teamId: string) =>
  useTeamMutation((userId: string) => api.delete(`/api/teams/${teamId}/members/${userId}`), teamId);

export const useSetTeamModels = (teamId: string) =>
  useTeamMutation((body: SetModelAccessRequest) => api.put(`/api/teams/${teamId}/models`, body), teamId);
