import type { ReactNode } from 'react';
import { formatMoney } from '../lib/format';

/** Presentational primitives. No data fetching and no business rules live in this file. */

export function PageHead({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Dot({ state }: { state: 'ok' | 'warn' | 'down' | 'idle' }) {
  return <span className="dot" data-state={state} />;
}

/**
 * The signature element: wherever money has a ceiling, the same rail shows how close it is.
 * Used on the dashboard, the developer page, and the budget table.
 */
export function BudgetRail({ spend, budget }: { spend: number; budget: number | null }) {
  if (!budget) return <span className="muted">No budget</span>;

  const ratio = Math.min(spend / budget, 1);
  const state = spend >= budget ? 'over' : ratio > 0.8 ? 'warn' : 'ok';

  return (
    <div>
      <div
        className="rail"
        data-state={state}
        role="meter"
        aria-valuenow={spend}
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-label="Budget consumed"
      >
        <i style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="rail-label">
        {formatMoney(spend)} of {formatMoney(budget)}
      </div>
    </div>
  );
}

/** A column header prefixed with ">" is right-aligned, because it holds a number. */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            {head.map((heading) => (
              <th key={heading} className={heading.startsWith('>') ? 'num' : undefined}>
                {heading.replace(/^>/, '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td colSpan={99}>
        <div className="empty">{children}</div>
      </td>
    </tr>
  );
}

export function Notice({ kind, children }: { kind: 'error' | 'ok'; children: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error ? (
        <div className="hint" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      ) : (
        hint && <div className="hint">{hint}</div>
      )}
    </div>
  );
}

/** One shape for every loading/error/empty state, so pages do not each invent their own. */
export function QueryState({
  isPending,
  error,
  children,
}: {
  isPending: boolean;
  error: unknown;
  children: ReactNode;
}) {
  if (isPending) return <div className="empty">Loading…</div>;
  if (error) return <Notice kind="error">{error instanceof Error ? error.message : 'Something failed'}</Notice>;
  return <>{children}</>;
}
