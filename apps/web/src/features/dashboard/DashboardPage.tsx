import { Link } from 'react-router-dom';
import { formatCompact, formatCount, formatMoney } from '../../shared/lib/format';
import { Badge, Empty, Meter, Notice, PageHead, QueryState, Section, Stat, Status, Table } from '../../shared/ui';
import { useIsAdmin } from '../auth/queries';
import {
  useHealth,
  useUsageByDeveloper,
  useUsageByModel,
  useUsageByProvider,
  useUsageTotals,
} from '../usage/queries';

export function DashboardPage() {
  const isAdmin = useIsAdmin();

  const totals = useUsageTotals();
  // Admin-only on the server. Asking anyway would only trade an empty table for a 403.
  const byDeveloper = useUsageByDeveloper({}, isAdmin);
  const byModel = useUsageByModel();
  const byProvider = useUsageByProvider();
  const health = useHealth();

  const value = (render: (data: NonNullable<typeof totals.data>) => string) =>
    totals.data ? render(totals.data) : '—';

  const topSpend = Math.max(...(byDeveloper.data?.map((row) => row.spend) ?? [0]), 0.0001);

  return (
    <div className="stack">
      <PageHead
        title="Overview"
        description={
          totals.data
            ? `Spend and traffic from ${totals.data.range.from} to ${totals.data.range.to}, as metered by the gateway.`
            : 'Spend and traffic, as metered by the gateway.'
        }
        action={
          <Link className="btn" to="/usage">
            View usage
          </Link>
        }
      />

      {totals.error && <Notice kind="error">{totals.error.message}</Notice>}

      <div className="grid grid-stats">
        <Stat label="Total spend" value={value((d) => formatMoney(d.spend))} />
        <Stat label="Requests" value={value((d) => formatCount(d.requests))} />
        <Stat label="Input tokens" value={value((d) => formatCompact(d.inputTokens))} />
        <Stat label="Output tokens" value={value((d) => formatCompact(d.outputTokens))} />
        <Stat label="Developers" value={value((d) => String(d.activeDevelopers))} />
        <Stat label="Models live" value={value((d) => String(d.activeModels))} />
      </div>

      {isAdmin && (
        <Section title="Spend by developer">
          <QueryState isPending={byDeveloper.isPending} error={byDeveloper.error}>
            <Table head={['Developer', 'Share', '>Requests', '>Spend']}>
              {byDeveloper.data?.length === 0 && <FirstStep isAdmin />}
              {byDeveloper.data?.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link to={`/developers/${row.id}`}>{row.name}</Link>
                    <div className="mono muted">{row.email}</div>
                  </td>
                  <td style={{ width: '28%' }}>
                    <Meter ratio={row.spend / topSpend} />
                  </td>
                  <td className="num">{formatCount(row.requests)}</td>
                  <td className="num">{formatMoney(row.spend)}</td>
                </tr>
              ))}
            </Table>
          </QueryState>
        </Section>
      )}

      <div className="grid grid-half">
        <Section title="Spend by model">
          <QueryState isPending={byModel.isPending} error={byModel.error}>
            <Table head={['Model', '>Requests', '>Spend']}>
              {/* The only empty state a non-admin reaches, so it carries the first-run guidance. */}
              {byModel.data?.length === 0 && <FirstStep isAdmin={isAdmin} />}
              {byModel.data?.map((row) => (
                <tr key={row.name}>
                  <td className="mono">{row.name}</td>
                  <td className="num">{formatCount(row.requests)}</td>
                  <td className="num">{formatMoney(row.spend)}</td>
                </tr>
              ))}
            </Table>
          </QueryState>
        </Section>

        <Section title="Spend by provider">
          <QueryState isPending={byProvider.isPending} error={byProvider.error}>
            <Table head={['Provider', '>Requests', '>Spend']}>
              {byProvider.data?.length === 0 && <FirstStep isAdmin={isAdmin} />}
              {byProvider.data?.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td className="num">{formatCount(row.requests)}</td>
                  <td className="num">{formatMoney(row.spend)}</td>
                </tr>
              ))}
            </Table>
          </QueryState>
        </Section>
      </div>

      <Section title="Stack" description="Everything this control plane depends on.">
        <div className="card">
          {Object.entries(health.data?.services ?? { gateway: 'down' }).map(([name, state], index) => (
            <div
              key={name}
              className="row"
              style={{
                justifyContent: 'space-between',
                padding: '12px 20px',
                borderTop: index === 0 ? 'none' : '1px solid var(--gray-200)',
              }}
            >
              <Status state={state === 'ok' ? 'ok' : 'down'}>{name}</Status>
              <Badge tone={state === 'ok' ? 'ok' : 'error'}>{state}</Badge>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/**
 * A fresh install has nothing metered because nothing has been set up yet, and the order is
 * Provider → Model → Developer → Key → Connect. Offering "add a developer" first was the wrong
 * end of it: a developer with no models cannot call anything. Someone without the authority to
 * start that chain is told who can, rather than handed a button that 403s.
 */
function FirstStep({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Empty
      title="No traffic yet"
      action={
        isAdmin ? (
          <Link className="btn small" to="/providers/new">
            Connect a provider
          </Link>
        ) : undefined
      }
    >
      {isAdmin
        ? 'Connect a provider, publish a model from it, then issue a developer a key.'
        : 'Ask an owner or admin to connect a provider and grant your team a model.'}
    </Empty>
  );
}
