import { useState } from 'react';
import { formatCompact, formatCount, formatMoney, trailingDays } from '../../shared/lib/format';
import { Empty, PageHead, QueryState, Stat, Table } from '../../shared/ui';
import { useUsageTotals } from './queries';

const RANGES = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
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
          <div className="row">
            {RANGES.map((option) => (
              <button
                key={option.days}
                type="button"
                className={days === option.days ? 'primary' : ''}
                onClick={() => setDays(option.days)}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-stats">
        <Stat label="Spend" value={usage.data ? formatMoney(usage.data.spend) : '—'} />
        <Stat label="Requests" value={usage.data ? formatCount(usage.data.requests) : '—'} />
        <Stat label="Input tokens" value={usage.data ? formatCompact(usage.data.inputTokens) : '—'} />
        <Stat label="Output tokens" value={usage.data ? formatCompact(usage.data.outputTokens) : '—'} />
      </div>

      <section>
        <h2>Daily spend</h2>
        <QueryState isPending={usage.isPending} error={usage.error}>
          <Table head={['Date', 'Share', '>Requests', '>Spend']}>
            {usage.data?.daily.length === 0 && <Empty>Nothing metered in this window.</Empty>}
            {usage.data?.daily.map((day) => (
              <tr key={day.date}>
                <td className="mono">{day.date}</td>
                <td style={{ width: '45%' }}>
                  <div className="rail">
                    <i style={{ width: `${(day.spend / peak) * 100}%` }} />
                  </div>
                </td>
                <td className="num">{formatCount(day.requests)}</td>
                <td className="num">{formatMoney(day.spend)}</td>
              </tr>
            ))}
          </Table>
        </QueryState>
      </section>
    </div>
  );
}
