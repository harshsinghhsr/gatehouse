import { Link } from 'react-router-dom';
import { formatCompact, formatCount, formatMoney } from '../../shared/lib/format';
import { Badge, Empty, Meter, PageHead, Section, Stat, Status, Table } from '../../shared/ui';
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

      <div className="grid grid-stats">
        <Stat label="Total spend" value={value((d) => formatMoney(d.spend))} />
        <Stat label="Requests" value={value((d) => formatCount(d.requests))} />
        <Stat label="Input tokens" value={value((d) => formatCompact(d.inputTokens))} />
        <Stat label="Output tokens" value={value((d) => formatCompact(d.outputTokens))} />
        <Stat label="Developers" value={value((d) => String(d.activeDevelopers))} />
        <Stat label="Models live" value={value((d) => String(d.activeModels))} />
      </div>

      <Section title="Spend by developer">
        <Table head={['Developer', 'Share', '>Requests', '>Spend']}>
          {byDeveloper.data?.length === 0 && (
            <Empty title="No traffic yet" action={<Link className="btn small" to="/developers">Add a developer</Link>}>
              Issue a key on a developer and their spend shows up here.
            </Empty>
          )}
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
      </Section>

      <div className="grid grid-half">
        <Section title="Spend by model">
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
        </Section>

        <Section title="Spend by provider">
          <Table head={['Provider', '>Requests', '>Spend']}>
            {byProvider.data?.length === 0 && <Empty>Nothing metered in this window.</Empty>}
            {byProvider.data?.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td className="num">{formatCount(row.requests)}</td>
                <td className="num">{formatMoney(row.spend)}</td>
              </tr>
            ))}
          </Table>
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
