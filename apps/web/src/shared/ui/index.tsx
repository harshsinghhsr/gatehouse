import type { ReactNode } from 'react';
import { formatMoney } from '../lib/format';

/** Presentational primitives. No data fetching and no business rules live in this file. */

/** Our own mark: a keyhole set in an arch — the gatehouse, not a borrowed logo. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M4 21V10a8 8 0 0 1 16 0v11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="12" cy="11" r="2.25" fill="currentColor" />
      <path d="M12 13.25V16.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

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

/** A titled block. `description` sits beside the heading, an `action` sits at the far right. */
export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * The Geist form card: content, then a tinted footer holding the explanation and the submit.
 * Keeping the two together is what stops every form inventing its own button placement.
 */
export function FormCard({
  children,
  hint,
  action,
  onSubmit,
  maxWidth = 560,
}: {
  children: ReactNode;
  hint?: ReactNode;
  action: ReactNode;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  maxWidth?: number;
}) {
  return (
    <form className="card" style={{ maxWidth }} onSubmit={onSubmit}>
      <div className="card-pad" style={{ paddingBottom: 4 }}>
        {children}
      </div>
      <div className="card-foot">
        <span>{hint}</span>
        {action}
      </div>
    </form>
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

export function Badge({
  tone = 'neutral',
  mono,
  children,
}: {
  tone?: 'neutral' | 'ok' | 'warn' | 'error' | 'info';
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={mono ? 'badge mono-badge' : 'badge'} data-tone={tone}>
      {children}
    </span>
  );
}

/** Status as a dot plus a word, so it reads without relying on colour alone. */
export function Status({ state, children }: { state: 'ok' | 'warn' | 'down' | 'idle'; children: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <Dot state={state} />
      {children}
    </span>
  );
}

/**
 * Wherever money has a ceiling, the same meter shows how close it is — dashboard, developer
 * page, budget table. Blue until 80%, amber past it, red once the gateway starts refusing.
 */
export function BudgetRail({ spend, budget }: { spend: number; budget: number | null }) {
  if (!budget) return <span className="muted">No budget</span>;

  const ratio = Math.min(spend / budget, 1);
  const state = spend >= budget ? 'over' : ratio > 0.8 ? 'warn' : 'ok';

  return (
    <div>
      <div
        className="meter"
        data-state={state}
        role="meter"
        aria-valuenow={spend}
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-label="Budget consumed"
      >
        <i style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="meter-label">
        <b>{formatMoney(spend)}</b> of {formatMoney(budget)}
      </div>
    </div>
  );
}

/** A bare proportion bar, for comparing rows against the largest value in a column. */
export function Meter({ ratio }: { ratio: number }) {
  return (
    <div className="meter">
      <i style={{ width: `${Math.min(Math.max(ratio, 0), 1) * 100}%` }} />
    </div>
  );
}

/** A column header prefixed with ">" is right-aligned, because it holds a number. */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="card">
      <div className="table-wrap">
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
    </div>
  );
}

/** An empty table body: a reason and, where there is one, the action that fixes it. */
export function Empty({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <tr>
      <td colSpan={99} style={{ padding: 0 }}>
        <div className="empty-state">
          {title && <h3>{title}</h3>}
          <p>{children}</p>
          {action && <div className="row">{action}</div>}
        </div>
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
      {error ? <div className="field-error">{error}</div> : hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** Code with a copy button that appears on hover, the way every snippet on Vercel behaves. */
export function Code({ children }: { children: string }) {
  return (
    <div className="code">
      <pre>{children}</pre>
      <button type="button" className="small" onClick={() => void navigator.clipboard?.writeText(children)}>
        Copy
      </button>
    </div>
  );
}

export function Skeleton({ width = '100%', height = 14 }: { width?: number | string; height?: number }) {
  return <div className="skeleton" style={{ width, height }} />;
}

/** One shape for every loading and error state, so pages do not each invent their own. */
export function QueryState({
  isPending,
  error,
  children,
}: {
  isPending: boolean;
  error: unknown;
  children: ReactNode;
}) {
  if (isPending) {
    return (
      <div className="card card-pad" style={{ display: 'grid', gap: 12 }} aria-busy="true" aria-label="Loading">
        <Skeleton width="30%" />
        <Skeleton />
        <Skeleton width="70%" />
      </div>
    );
  }
  if (error) return <Notice kind="error">{error instanceof Error ? error.message : 'Something failed'}</Notice>;
  return <>{children}</>;
}
