import { useState } from 'react';
import { formatCompact, formatCount, formatMoney, trailingDays } from '../../shared/lib/format';
import { Empty, Meter, PageHead, QueryState, Section, Stat, Table } from '../../shared/ui';
import { useUsageTotals } from './queries';

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export function UsagePage() {
  const [days, setDays] = useState(30);
  const range = trailingDays(days);
  const usage = useUsageTotals(range);

  const peak = Math.max(...(usage.data?.daily.map((day) => day.spend) ?? [0]), 0.0001);

  return (
    <div className="stack">
      <PageHead
        title="Usage"
        description="Metered by the gateway at request time. These are the same figures your providers bill you for."
        action={
          <div className="row" style={{ gap: 4 }} role="group" aria-label="Date range">
            {RANGES.map((option) => (
              <button
                key={option.days}
                type="button"
                className={days === option.days ? 'primary small' : 'small'}
                aria-pressed={days === option.days}
                onClick={() => setDays(option.days)}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-stats">
        <Stat label="Spend" value={usage.data ? formatMoney(usage.data.spend) : '—'} sub={`Last ${days} days`} />
        <Stat label="Requests" value={usage.data ? formatCount(usage.data.requests) : '—'} />
        <Stat label="Input tokens" value={usage.data ? formatCompact(usage.data.inputTokens) : '—'} />
        <Stat label="Output tokens" value={usage.data ? formatCompact(usage.data.outputTokens) : '—'} />
      </div>

      <Section title="Daily spend" description="Each bar is relative to the busiest day in the window.">
        <QueryState isPending={usage.isPending} error={usage.error}>
          <Table head={['Date', 'Share', '>Requests', '>Spend']}>
            {usage.data?.daily.length === 0 && <Empty>Nothing metered in this window.</Empty>}
            {usage.data?.daily.map((day) => (
              <tr key={day.date}>
                <td className="mono">{day.date}</td>
                <td style={{ width: '45%' }}>
                  <Meter ratio={day.spend / peak} />
                </td>
                <td className="num">{formatCount(day.requests)}</td>
                <td className="num">{formatMoney(day.spend)}</td>
              </tr>
            ))}
          </Table>
        </QueryState>
      </Section>
    </div>
  );
}
