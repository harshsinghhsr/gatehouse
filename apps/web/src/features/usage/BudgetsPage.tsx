import { Link } from 'react-router-dom';
import { Badge, BudgetRail, Empty, PageHead, QueryState, Table } from '../../shared/ui';
import { useBudgets, useUsageByDeveloper } from './queries';

export function BudgetsPage() {
  const budgets = useBudgets();
  const usage = useUsageByDeveloper();

  const spendByDeveloper = new Map(usage.data?.map((row) => [row.id, row.spend]));

  return (
    <div className="stack">
      <PageHead
        title="Budgets"
        description="Caps are enforced by the gateway, not by this dashboard. Set one on a developer or a team."
      />

      <QueryState isPending={budgets.isPending} error={budgets.error}>
        <Table head={['Holder', 'Period', 'Consumed', '>Rate limit']}>
          {budgets.data?.length === 0 && (
            <Empty
              title="No budgets set"
              action={
                <Link className="btn small" to="/developers">
                  Open a developer
                </Link>
              }
            >
              Without a cap, a runaway loop bills whatever it can reach.
            </Empty>
          )}
          {budgets.data?.map((budget) => (
            <tr key={budget.id}>
              <td>
                {budget.holder.kind === 'developer' ? (
                  <>
                    <Link to={`/developers/${budget.holder.id}`}>{budget.holder.name}</Link>
                    <div className="mono muted">{budget.holder.email}</div>
                  </>
                ) : (
                  budget.holder.name
                )}
              </td>
              <td>
                <Badge>{budget.period.toLowerCase()}</Badge>
              </td>
              <td style={{ width: '40%' }}>
                <BudgetRail spend={spendByDeveloper.get(budget.holder.id) ?? 0} budget={budget.maxBudget} />
              </td>
              <td className="num">{budget.rpmLimit ? `${budget.rpmLimit}/min` : '—'}</td>
            </tr>
          ))}
        </Table>
      </QueryState>
    </div>
  );
}
