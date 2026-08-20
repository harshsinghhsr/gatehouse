import type { LoginRequest, MeResponse, RegisterRequest } from '@gatehouse/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/query-keys';

/** The signed-in session. Every page reads it from the cache rather than refetching. */
export function useSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: () => api.get<MeResponse>('/api/me'),
    retry: false,
  });
}

export function useSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => api.post<{ user: MeResponse['user'] }>('/api/auth/login', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.session }),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterRequest) => api.post<{ user: MeResponse['user'] }>('/api/auth/register', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.session }),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    // Everything in the cache belonged to the session that just ended.
    onSuccess: () => queryClient.clear(),
  });
}
