import { Link } from 'react-router-dom';
import { formatDateTime } from '../../shared/lib/format';
import { Dot, Empty, PageHead, QueryState, Table } from '../../shared/ui';
import { useProviders } from './queries';

export function ProvidersPage() {
  const providers = useProviders();

  return (
    <div className="stack">
      <PageHead
        title="Providers"
        description="Credentials are verified on the server, stored in the secret store, and pushed to the gateway. They are never shown again."
        action={
          <Link className="btn btn-primary" to="/providers/new">
            Add provider
          </Link>
        }
      />

      <QueryState isPending={providers.isPending} error={providers.error}>
        <Table head={['Provider', 'Type', 'Status', '>Models', 'Last check']}>
          {providers.data?.length === 0 && (
            <Empty>No providers yet. Add Azure OpenAI, OpenAI, or Anthropic to begin.</Empty>
          )}
          {providers.data?.map((provider) => (
            <tr key={provider.id}>
              <td>
                <Link to={`/providers/${provider.id}`}>{provider.name}</Link>
              </td>
              <td className="muted">{provider.displayName}</td>
              <td>
                <Dot state={provider.lastTestError ? 'down' : provider.status === 'ACTIVE' ? 'ok' : 'idle'} />
                {provider.lastTestError ? 'Failing' : provider.status === 'ACTIVE' ? 'Active' : 'Disabled'}
              </td>
              <td className="num">{provider.modelCount}</td>
              <td className="mono muted">
                {provider.lastTestedAt ? formatDateTime(provider.lastTestedAt) : 'never'}
              </td>
            </tr>
          ))}
        </Table>
      </QueryState>
    </div>
  );
}
