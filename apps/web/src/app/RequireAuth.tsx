import type { ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { PageHead } from '../shared/ui';
import { useIsAdmin, useSession } from '../features/auth/queries';

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

/**
 * The admin surfaces, as a layout route. A typed URL or an old bookmark would otherwise hand a
 * member a page of 403s; saying so plainly beats a redirect that looks like the link is broken.
 * This is clarity, not security — the API guards every one of these routes itself.
 */
export function RequireAdmin() {
  const isAdmin = useIsAdmin();
  const session = useSession();

  if (session.isPending) return <div className="stack" aria-busy="true" />;
  if (isAdmin) return <Outlet />;

  return (
    <div className="stack">
      <PageHead
        title="Admins only"
        description="This section manages providers, models, developers and budgets for the whole instance. Ask an owner or admin if you need something changed here."
        action={
          <Link className="btn" to="/dashboard">
            Back to overview
          </Link>
        }
      />
    </div>
  );
}
