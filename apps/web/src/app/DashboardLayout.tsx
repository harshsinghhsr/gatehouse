import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Mark } from '../shared/ui';
import { applyTheme, readTheme, type Theme } from '../shared/lib/theme';
import { useSession, useSignOut } from '../features/auth/queries';

const TABS = [
  { to: '/dashboard', label: 'Overview' },
  { to: '/usage', label: 'Usage' },
  { to: '/providers', label: 'Providers' },
  { to: '/models', label: 'Models' },
  { to: '/developers', label: 'Developers' },
  { to: '/teams', label: 'Teams' },
  { to: '/budgets', label: 'Budgets' },
  { to: '/connect', label: 'Connect' },
  { to: '/audit-logs', label: 'Audit log' },
  { to: '/settings', label: 'Settings' },
];

export function DashboardLayout() {
  const { data: session } = useSession();
  const organization = session?.organizations.find((org) => org.id === session.activeOrganizationId);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="bar-inner">
          <Mark />
          <nav className="crumbs" aria-label="Breadcrumb">
            <span className="crumb-sep">/</span>
            <span className="crumb-org">{organization?.name ?? 'Gatehouse'}</span>
            {organization?.slug && <span className="crumb-badge">{organization.slug}</span>}
          </nav>

          <div className="topbar-right">
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </header>

      <nav className="tabs" aria-label="Sections">
        <div className="bar-inner">
          {TABS.map((tab) => (
            <NavLink key={tab.to} to={tab.to} className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  // Read on mount rather than at module load: localStorage is not available while pre-rendering.
  useEffect(() => setTheme(readTheme()), []);

  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };

  return (
    <button
      type="button"
      className="icon-button"
      title={`Theme: ${theme}`}
      aria-label={`Theme: ${theme}. Switch to ${next[theme]}.`}
      onClick={() => {
        const chosen = next[theme];
        setTheme(chosen);
        applyTheme(chosen);
      }}
    >
      {theme === 'dark' ? <MoonIcon /> : theme === 'light' ? <SunIcon /> : <SystemIcon />}
    </button>
  );
}

function AccountMenu() {
  const navigate = useNavigate();
  const signOut = useSignOut();
  const { data: session } = useSession();

  const initials = (session?.user.name ?? '?')
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <details className="menu">
      <summary aria-label="Account">
        <span className="avatar">{initials}</span>
      </summary>
      <div className="menu-panel">
        <div className="menu-head">
          <div style={{ fontWeight: 500 }}>{session?.user.name}</div>
          <div className="mono muted" style={{ fontSize: 12 }}>
            {session?.user.email}
          </div>
        </div>
        <button type="button" className="menu-item" onClick={() => navigate('/settings')}>
          Settings
        </button>
        <button type="button" className="menu-item" onClick={() => navigate('/connect')}>
          Connect an SDK
        </button>
        <button
          type="button"
          className="menu-item"
          onClick={() => signOut.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) })}
        >
          Sign out
        </button>
      </div>
    </details>
  );
}

const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const SunIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

const MoonIcon = () => (
  <svg {...iconProps}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);

const SystemIcon = () => (
  <svg {...iconProps}>
    <rect x="2" y="4" width="20" height="14" rx="2" />
    <path d="M8 21h8m-4-3v3" />
  </svg>
);
