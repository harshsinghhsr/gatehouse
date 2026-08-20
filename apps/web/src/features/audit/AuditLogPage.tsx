import { type AuditAction, auditActionSchema } from '@gatehouse/shared';
import { useState } from 'react';
import { formatDateTime } from '../../shared/lib/format';
import { Badge, Empty, PageHead, QueryState, Table } from '../../shared/ui';
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
          {logs.data?.logs.length === 0 && (
            <Empty title="Nothing recorded yet">
              Entries appear as soon as someone changes a provider, a key, or an access grant.
            </Empty>
          )}
          {logs.data?.logs.map((entry) => (
            <tr key={entry.id}>
              <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                {formatDateTime(entry.createdAt)}
              </td>
              <td>
                <Badge mono>{entry.action}</Badge>
              </td>
              <td className="muted">{entry.targetType}</td>
              <td
                className="mono muted"
                style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={JSON.stringify(entry.metadata)}
              >
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
