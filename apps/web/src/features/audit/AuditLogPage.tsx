import { type AuditAction, auditActionSchema } from '@gatehouse/shared';
import { useState } from 'react';
import { formatDateTime } from '../../shared/lib/format';
import { Empty, PageHead, QueryState, Table } from '../../shared/ui';
import { useAuditLogs } from './queries';

const ACTIONS = auditActionSchema.options;

export function AuditLogPage() {
  const [action, setAction] = useState<AuditAction | undefined>();
  const logs = useAuditLogs(action);

  return (
    <div className="stack">
      <PageHead
        title="Audit log"
        description="Every change to providers, developers, keys, access, and budgets. Secret values are redacted before a row is written."
        action={
          <select
            value={action ?? ''}
            onChange={(event) => setAction((event.target.value || undefined) as AuditAction | undefined)}
            style={{ width: 240 }}
            aria-label="Filter by action"
          >
            <option value="">All actions</option>
            {ACTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        }
      />

      <QueryState isPending={logs.isPending} error={logs.error}>
        <Table head={['When', 'Action', 'Target', 'Detail', 'IP']}>
          {logs.data?.logs.length === 0 && <Empty>Nothing recorded yet.</Empty>}
          {logs.data?.logs.map((entry) => (
            <tr key={entry.id}>
              <td className="mono muted">{formatDateTime(entry.createdAt)}</td>
              <td>
                <span className="tag">{entry.action}</span>
              </td>
              <td className="mono muted">{entry.targetType}</td>
              <td className="mono muted" style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {JSON.stringify(entry.metadata)}
              </td>
              <td className="mono muted">{entry.ip ?? '—'}</td>
            </tr>
          ))}
        </Table>
      </QueryState>
    </div>
  );
}
