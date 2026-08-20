import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession, useSignOut } from '../features/auth/queries';

const SECTIONS = [
  {
    label: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard' },
      { to: '/usage', label: 'Usage' },
    ],
  },
  {
    label: 'Gateway',
    items: [
      { to: '/providers', label: 'Providers' },
      { to: '/models', label: 'Models' },
    ],
  },
  {
    label: 'Access',
    items: [
      { to: '/developers', label: 'Developers' },
      { to: '/teams', label: 'Teams' },
      { to: '/budgets', label: 'Budgets' },
    ],
  },
  {
    label: 'You',
    items: [
      { to: '/connect', label: 'Connect' },
      { to: '/audit-logs', label: 'Audit log' },
      { to: '/settings', label: 'Settings' },
    ],
  },
];

export function DashboardLayout() {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const signOut = useSignOut();

  const organization = session?.organizations.find((org) => org.id === session.activeOrganizationId);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          {organization?.name ?? 'Gatehouse'}
          <span>{organization?.slug}</span>
        </div>

        <nav className="nav">
          {SECTIONS.map((section) => (
            <div key={section.label}>
              <div className="nav-group">{section.label}</div>
              {section.items.map((item) => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div style={{ color: 'var(--ink-soft)' }}>{session?.user.name}</div>
          <div className="mono" style={{ fontSize: 11 }}>
            {session?.role.toLowerCase()}
          </div>
          <button
            type="button"
            className="small"
            style={{ marginTop: 10, border: 'none', padding: 0, color: 'var(--ink-faint)' }}
            onClick={() => signOut.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) })}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
