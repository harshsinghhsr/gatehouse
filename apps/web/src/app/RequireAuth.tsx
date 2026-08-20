import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../features/auth/queries';

/** Gate for every dashboard route: no session, no page. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <main className="auth" aria-busy="true" />;
  if (session.isError || !session.data) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
