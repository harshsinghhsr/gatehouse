import { Link } from 'react-router-dom';
import { formatCompact, formatCount, formatMoney } from '../../shared/lib/format';
import { Dot, Empty, PageHead, Stat, Table } from '../../shared/ui';
import {
  useHealth,
  useUsageByDeveloper,
  useUsageByModel,
  useUsageByProvider,
  useUsageTotals,
} from '../usage/queries';

export function DashboardPage() {
  const totals = useUsageTotals();
  const byDeveloper = useUsageByDeveloper();
  const byModel = useUsageByModel();
  const byProvider = useUsageByProvider();
  const health = useHealth();

  const value = (render: (data: NonNullable<typeof totals.data>) => string) =>
    totals.data ? render(totals.data) : '—';

  return (
    <div className="stack">
      <PageHead
        title="Dashboard"
        description={
          totals.data
            ? `Spend and traffic from ${totals.data.range.from} to ${totals.data.range.to}, as metered by the gateway.`
            : 'Spend and traffic, as metered by the gateway.'
        }
      />

      <div className="grid grid-stats">
        <Stat label="Total spend" value={value((d) => formatMoney(d.spend))} />
        <Stat label="Requests" value={value((d) => formatCount(d.requests))} />
        <Stat label="Input tokens" value={value((d) => formatCompact(d.inputTokens))} />
        <Stat label="Output tokens" value={value((d) => formatCompact(d.outputTokens))} />
        <Stat label="Developers" value={value((d) => String(d.activeDevelopers))} />
        <Stat label="Models live" value={value((d) => String(d.activeModels))} />
      </div>

      <div className="grid grid-half">
        <section>
          <h2>Spend by developer</h2>
          <Table head={['Developer', '>Requests', '>Spend']}>
            {byDeveloper.data?.length === 0 && (
              <Empty>No traffic yet. Issue a key on a developer to get started.</Empty>
            )}
            {byDeveloper.data?.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/developers/${row.id}`}>{row.name}</Link>
                  <div className="mono muted">{row.email}</div>
                </td>
                <td className="num">{formatCount(row.requests)}</td>
                <td className="num">{formatMoney(row.spend)}</td>
              </tr>
            ))}
          </Table>
        </section>

        <section>
          <h2>Spend by model</h2>
          <Table head={['Model', '>Requests', '>Spend']}>
            {byModel.data?.length === 0 && <Empty>Nothing metered in this window.</Empty>}
            {byModel.data?.map((row) => (
              <tr key={row.name}>
                <td className="mono">{row.name}</td>
                <td className="num">{formatCount(row.requests)}</td>
                <td className="num">{formatMoney(row.spend)}</td>
              </tr>
            ))}
          </Table>
        </section>

        <section>
          <h2>Spend by provider</h2>
          <Table head={['Provider', '>Requests', '>Spend']}>
            {byProvider.data?.length === 0 && <Empty>Nothing metered in this window.</Empty>}
            {byProvider.data?.map((row) => (
              <tr key={row.name}>
                <td className="mono">{row.name}</td>
                <td className="num">{formatCount(row.requests)}</td>
                <td className="num">{formatMoney(row.spend)}</td>
              </tr>
            ))}
          </Table>
        </section>

        <section>
          <h2>Stack</h2>
          <div className="card card-pad">
            {Object.entries(health.data?.services ?? { gateway: 'down' }).map(([name, state]) => (
              <div key={name} className="row" style={{ justifyContent: 'space-between', padding: '5px 0' }}>
                <span>
                  <Dot state={state === 'ok' ? 'ok' : 'down'} />
                  {name}
                </span>
                <span className="mono muted">{state}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
