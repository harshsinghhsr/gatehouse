import type { IssuedKey } from '@gatehouse/shared';
import { type FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatDate } from '../../shared/lib/format';
import { BudgetRail, Empty, Field, Notice, PageHead, QueryState, Table } from '../../shared/ui';
import { useModels } from '../models/queries';
import {
  useDeveloper,
  useIssueKey,
  useRevokeKey,
  useRotateKey,
  useSetDeveloperModels,
  useUpdateDeveloper,
} from './queries';

export function DeveloperDetailPage() {
  const { id = '' } = useParams();
  const developer = useDeveloper(id);
  const models = useModels();

  const updateDeveloper = useUpdateDeveloper(id);
  const setModels = useSetDeveloperModels(id);
  const issueKey = useIssueKey(id);
  const rotateKey = useRotateKey(id);
  const revokeKey = useRevokeKey(id);

  // Held in local state deliberately: the plaintext key is never refetchable.
  const [issued, setIssued] = useState<IssuedKey | null>(null);

  function saveModels(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const modelIds = new FormData(event.currentTarget).getAll('model').map(String);
    setModels.mutate({ modelIds });
  }

  function saveBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const rpm = data.get('rpmLimit');

    updateDeveloper.mutate({
      budget: {
        maxBudget: Number(data.get('maxBudget')),
        period: data.get('period') === 'DAILY' ? 'DAILY' : 'MONTHLY',
        rpmLimit: rpm ? Number(rpm) : null,
      },
    });
  }

  return (
    <QueryState isPending={developer.isPending} error={developer.error}>
      {developer.data && (
        <div className="stack">
          <PageHead
            title={developer.data.name}
            description={[
              developer.data.email,
              developer.data.role.toLowerCase(),
              developer.data.teams.map((team) => team.name).join(', '),
            ]
              .filter(Boolean)
              .join(' · ')}
            action={
              <div className="row">
                <button
                  type="button"
                  className="primary"
                  disabled={developer.data.status !== 'ACTIVE' || issueKey.isPending}
                  onClick={() => issueKey.mutate(undefined, { onSuccess: setIssued })}
                >
                  Create key
                </button>
                <button
                  type="button"
                  disabled={updateDeveloper.isPending}
                  onClick={() =>
                    updateDeveloper.mutate({
                      status: developer.data.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                    })
                  }
                >
                  {developer.data.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                </button>
              </div>
            }
          />

          {issueKey.error && <Notice kind="error">{issueKey.error.message}</Notice>}

          {issued && (
            <div className="card card-pad">
              <h2>Copy this key now</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                It is shown once and is not stored anywhere in this platform. If it is lost, rotate the key.
              </p>
              <pre>{issued.key}</pre>
              <div className="row" style={{ marginTop: 12 }}>
                <button type="button" onClick={() => navigator.clipboard.writeText(issued.key)}>
                  Copy
                </button>
                <button type="button" onClick={() => setIssued(null)}>
                  Done
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-half">
            <section>
              <h2>Budget</h2>
              <form className="card card-pad" onSubmit={saveBudget}>
                <div style={{ marginBottom: 16 }}>
                  <BudgetRail
                    spend={developer.data.spend ?? 0}
                    budget={developer.data.budget?.maxBudget ?? null}
                  />
                </div>

                <Field label="Budget cap">
                  <input
                    name="maxBudget"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    defaultValue={developer.data.budget?.maxBudget ?? 50}
                  />
                </Field>
                <Field label="Period">
                  <select name="period" defaultValue={developer.data.budget?.period ?? 'MONTHLY'}>
                    <option value="MONTHLY">Monthly</option>
                    <option value="DAILY">Daily</option>
                  </select>
                </Field>
                <Field label="Requests per minute (optional)">
                  <input
                    name="rpmLimit"
                    type="number"
                    min="1"
                    defaultValue={developer.data.budget?.rpmLimit ?? ''}
                  />
                </Field>

                <button type="submit" className="primary" disabled={updateDeveloper.isPending}>
                  Save budget
                </button>
                <div className="hint">The gateway enforces this. Requests past the cap are refused.</div>
              </form>
            </section>

            <section>
              <h2>Models</h2>
              <form className="card card-pad" onSubmit={saveModels}>
                {models.data?.length === 0 && <p className="muted">No models exist yet.</p>}
                {models.data?.map((model) => (
                  <label key={model.id} className="row" style={{ fontWeight: 400, marginBottom: 8 }}>
                    <input
                      type="checkbox"
                      name="model"
                      value={model.id}
                      defaultChecked={developer.data.models.some((granted) => granted.id === model.id)}
                    />
                    <span className="mono">{model.publicModelName}</span>
                    <span className="muted">{model.provider.name}</span>
                  </label>
                ))}

                {models.data && models.data.length > 0 && (
                  <button type="submit" className="primary" style={{ marginTop: 10 }} disabled={setModels.isPending}>
                    Save access
                  </button>
                )}
                <div className="hint">Saving updates every live key immediately.</div>
              </form>
            </section>
          </div>

          <section>
            <h2>Keys</h2>
            <Table head={['Key', 'Alias', 'Status', 'Created', '']}>
              {developer.data.keys.length === 0 && <Empty>No keys issued yet.</Empty>}
              {developer.data.keys.map((key) => (
                <tr key={key.id}>
                  <td className="mono">{key.keyPrefix ?? '—'}</td>
                  <td className="mono muted">{key.keyAlias}</td>
                  <td>{key.status.toLowerCase()}</td>
                  <td className="mono muted">{formatDate(key.createdAt)}</td>
                  <td className="num">
                    {key.status === 'ACTIVE' && (
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="small"
                          onClick={() => rotateKey.mutate(key.id, { onSuccess: setIssued })}
                        >
                          Rotate
                        </button>
                        <button
                          type="button"
                          className="small danger"
                          onClick={() => {
                            if (confirm('Revoke this key? Calls using it stop working immediately.')) {
                              revokeKey.mutate(key.id);
                            }
                          }}
                        >
                          Revoke
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          </section>
        </div>
      )}
    </QueryState>
  );
}
