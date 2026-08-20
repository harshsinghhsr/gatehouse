import { Link } from 'react-router-dom';
import { formatDateTime } from '../../shared/lib/format';
import { Badge, Empty, PageHead, QueryState, Status, Table } from '../../shared/ui';
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
            <Empty
              title="No providers yet"
              action={
                <Link className="btn btn-primary small" to="/providers/new">
                  Add provider
                </Link>
              }
            >
              Connect Azure OpenAI, OpenAI, or Anthropic. Your credential never leaves the server.
            </Empty>
          )}
          {providers.data?.map((provider) => (
            <tr key={provider.id}>
              <td>
                <Link to={`/providers/${provider.id}`}>{provider.name}</Link>
              </td>
              <td className="muted">{provider.displayName}</td>
              <td>
                {provider.lastTestError ? (
                  <Status state="down">Failing</Status>
                ) : provider.status === 'ACTIVE' ? (
                  <Status state="ok">Active</Status>
                ) : (
                  <Status state="idle">Disabled</Status>
                )}
              </td>
              <td className="num">{provider.modelCount}</td>
              <td className="muted">
                {provider.lastTestedAt ? formatDateTime(provider.lastTestedAt) : <Badge>never</Badge>}
              </td>
            </tr>
          ))}
        </Table>
      </QueryState>
    </div>
  );
}
