import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ApiError } from '../shared/api/client';
import { AuditLogPage } from '../features/audit/AuditLogPage';
import { BudgetsPage } from '../features/usage/BudgetsPage';
import { ConnectPage } from '../features/connect/ConnectPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { DeveloperDetailPage } from '../features/developers/DeveloperDetailPage';
import { DevelopersPage } from '../features/developers/DevelopersPage';
import { LoginPage } from '../features/auth/LoginPage';
import { ModelsPage } from '../features/models/ModelsPage';
import { NewProviderPage } from '../features/providers/NewProviderPage';
import { ProviderDetailPage } from '../features/providers/ProviderDetailPage';
import { ProvidersPage } from '../features/providers/ProvidersPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { TeamsPage } from '../features/teams/TeamsPage';
import { UsagePage } from '../features/usage/UsagePage';
import { DashboardLayout } from './DashboardLayout';
import { RequireAuth } from './RequireAuth';

/**
 * One QueryClient for the app. Retrying an authentication failure would only produce three
 * more 401s, so those fail fast and the router sends the person to the sign-in page.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        error instanceof ApiError && error.status < 500 ? false : failureCount < 2,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            element={
              <RequireAuth>
                <DashboardLayout />
              </RequireAuth>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/providers" element={<ProvidersPage />} />
            <Route path="/providers/new" element={<NewProviderPage />} />
            <Route path="/providers/:id" element={<ProviderDetailPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/developers" element={<DevelopersPage />} />
            <Route path="/developers/:id" element={<DeveloperDetailPage />} />
            <Route path="/teams" element={<TeamsPage />} />
            <Route path="/usage" element={<UsagePage />} />
            <Route path="/budgets" element={<BudgetsPage />} />
            <Route path="/connect" element={<ConnectPage />} />
            <Route path="/audit-logs" element={<AuditLogPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
