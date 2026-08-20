import type { IssuedKey } from '@gatehouse/shared';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatDate } from '../../shared/lib/format';
import {
  Badge,
  BudgetRail,
  Code,
  Empty,
  Field,
  FormCard,
  Notice,
  PageHead,
  QueryState,
  Section,
  Table,
} from '../../shared/ui';
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
          <div className="row" style={{ marginBottom: -12 }}>
            <Link className="link muted" to="/developers">
              ← Developers
            </Link>
          </div>

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
                  disabled={updateDeveloper.isPending}
                  onClick={() =>
                    updateDeveloper.mutate({
                      status: developer.data.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                    })
                  }
                >
                  {developer.data.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={developer.data.status !== 'ACTIVE' || issueKey.isPending}
                  onClick={() => issueKey.mutate(undefined, { onSuccess: setIssued })}
                >
                  Create key
                </button>
              </div>
            }
          />

          {issueKey.error && <Notice kind="error">{issueKey.error.message}</Notice>}

          {issued && (
            <div className="card">
              <div className="card-pad">
                <h2>Copy this key now</h2>
                <p className="hint" style={{ margin: '4px 0 14px' }}>
                  It is shown once and is not stored anywhere in this platform. If it is lost, rotate the key.
                </p>
                <Code>{issued.key}</Code>
              </div>
              <div className="card-foot">
                <span>Anyone holding this key can spend against this developer&rsquo;s budget.</span>
                <button type="button" onClick={() => setIssued(null)}>
                  Done
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-half">
            <Section title="Budget">
              <FormCard
                maxWidth={9999}
                hint="The gateway refuses requests past the cap."
                action={
                  <button type="submit" className="primary" disabled={updateDeveloper.isPending}>
                    Save budget
                  </button>
                }
                onSubmit={saveBudget}
              >
                <div style={{ marginBottom: 20 }}>
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
                <Field label="Requests per minute" hint="Optional.">
                  <input
                    name="rpmLimit"
                    type="number"
                    min="1"
                    defaultValue={developer.data.budget?.rpmLimit ?? ''}
                  />
                </Field>
              </FormCard>
            </Section>

            <Section title="Models">
              <FormCard
                maxWidth={9999}
                hint="Saving updates every live key immediately."
                action={
                  <button
                    type="submit"
                    className="primary"
                    disabled={setModels.isPending || !models.data?.length}
                  >
                    Save access
                  </button>
                }
                onSubmit={saveModels}
              >
                {models.data?.length === 0 && <p className="muted">No models exist yet.</p>}
                {models.data?.map((model) => (
                  <label key={model.id} className="choice">
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
              </FormCard>
            </Section>
          </div>

          <Section title="Keys">
            <Table head={['Key', 'Alias', 'Status', 'Created', '']}>
              {developer.data.keys.length === 0 && (
                <Empty title="No keys issued yet">Create one above. The plaintext is shown exactly once.</Empty>
              )}
              {developer.data.keys.map((key) => (
                <tr key={key.id}>
                  <td className="mono">{key.keyPrefix ?? '—'}</td>
                  <td className="mono muted">{key.keyAlias}</td>
                  <td>
                    <Badge tone={key.status === 'ACTIVE' ? 'ok' : 'neutral'}>{key.status.toLowerCase()}</Badge>
                  </td>
                  <td className="muted">{formatDate(key.createdAt)}</td>
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
          </Section>
        </div>
      )}
    </QueryState>
  );
}
