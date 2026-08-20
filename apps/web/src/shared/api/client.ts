import type { ErrorResponse } from '@gatehouse/shared';

/**
 * The single place the browser talks to the API. Credentials are the session cookie, which is
 * httpOnly — no token is ever readable from JavaScript.
 *
 * The API is always same-origin under /api: nginx proxies it in production, the Vite dev server
 * proxies it in development. Nothing about the deployment is baked into the bundle, so the same
 * built image runs on localhost and on your domain.
 */
const BASE_URL = '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const { error } = (payload ?? {}) as Partial<ErrorResponse>;
    throw new ApiError(
      error?.message ?? `Request failed (${response.status})`,
      response.status,
      error?.code ?? 'unknown_error',
    );
  }
  return payload as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
  put: <T,>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Serializes a date range the way the API expects, omitting empty bounds. */
export function withRange(path: string, range?: { from?: string; to?: string }): string {
  if (!range?.from && !range?.to) return path;
  const query = new URLSearchParams();
  if (range.from) query.set('from', range.from);
  if (range.to) query.set('to', range.to);
  return `${path}?${query}`;
}
