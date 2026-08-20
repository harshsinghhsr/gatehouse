import { type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Empty, Field, FormCard, Notice, PageHead, QueryState, Section, Table } from '../../shared/ui';
import { useCreateModel, useDeleteModel, useModels } from '../models/queries';
import { useDeleteProvider, useProvider, useTestProvider } from './queries';

export function ProviderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const provider = useProvider(id);
  const models = useModels();
  const testProvider = useTestProvider(id);
  const deleteProvider = useDeleteProvider();
  const createModel = useCreateModel();
  const deleteModel = useDeleteModel();

  const ownModels = models.data?.filter((model) => model.provider.id === id) ?? [];
  const isAzure = provider.data?.type === 'AZURE_OPENAI';

  function addModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    createModel.mutate(
      {
        providerId: id,
        publicModelName: String(data.get('publicModelName')),
        providerModelName: String(data.get('providerModelName')),
      },
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <QueryState isPending={provider.isPending} error={provider.error}>
      {provider.data && (
        <div className="stack">
          <div className="row" style={{ marginBottom: -12 }}>
            <Link className="link muted" to="/providers">
              ← Providers
            </Link>
          </div>

          <PageHead
            title={provider.data.name}
            description={`${provider.data.displayName} · ${ownModels.length} models registered with the gateway`}
            action={
              <div className="row">
                <button type="button" onClick={() => testProvider.mutate()} disabled={testProvider.isPending}>
                  {testProvider.isPending ? 'Checking…' : 'Test credential'}
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={deleteProvider.isPending}
                  onClick={() => {
                    if (!confirm('Delete this provider? Its models stop serving traffic immediately.')) return;
                    deleteProvider.mutate(id, { onSuccess: () => navigate('/providers') });
                  }}
                >
                  Delete
                </button>
              </div>
            }
          />

          {testProvider.data && (
            <Notice kind="ok">
              Credential works. The provider reports {testProvider.data.models.length} models.
            </Notice>
          )}
          {testProvider.error && <Notice kind="error">{testProvider.error.message}</Notice>}
          {!testProvider.data && !testProvider.error && provider.data.lastTestError && (
            <Notice kind="error">{provider.data.lastTestError}</Notice>
          )}

          <Section title="Configuration">
            <div className="card">
              {Object.entries(provider.data.config).length === 0 && (
                <div className="card-pad muted">Provider defaults.</div>
              )}
              {Object.entries(provider.data.config).map(([key, value], index) => (
                <div
                  key={key}
                  className="row"
                  style={{
                    justifyContent: 'space-between',
                    padding: '12px 20px',
                    borderTop: index === 0 ? 'none' : '1px solid var(--gray-200)',
                  }}
                >
                  <span className="muted">{key}</span>
                  <span className="mono">{value}</span>
                </div>
              ))}
              <div className="card-foot">The credential lives in the secret store and cannot be read back.</div>
            </div>
          </Section>

          <Section title="Models">
            <Table head={['Public name', 'Upstream', 'State', '']}>
              {ownModels.length === 0 && <Empty title="No models yet">Add the first one below.</Empty>}
              {ownModels.map((model) => (
                <tr key={model.id}>
                  <td className="mono">{model.publicModelName}</td>
                  <td className="mono muted">{model.providerModelName}</td>
                  <td>
                    <Badge tone={model.enabled ? 'ok' : 'neutral'}>{model.enabled ? 'Live' : 'Disabled'}</Badge>
                  </td>
                  <td className="num">
                    <button
                      type="button"
                      className="small danger"
                      onClick={() => {
                        if (confirm(`Remove ${model.publicModelName}?`)) deleteModel.mutate(model.id);
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section title="Add a model">
            <FormCard
              hint="Registered with the gateway immediately."
              action={
                <button type="submit" className="primary" disabled={createModel.isPending}>
                  Add model
                </button>
              }
              onSubmit={addModel}
            >
              <Field
                label="Public name"
                hint="What developers type, e.g. gpt-5. Stays stable even if the deployment changes."
              >
                <input name="publicModelName" required pattern="[a-zA-Z0-9._\-]+" placeholder="gpt-5" />
              </Field>
              <Field
                label="Upstream model"
                hint={isAzure ? 'The Azure deployment name.' : 'The provider’s own model identifier.'}
              >
                <input name="providerModelName" required placeholder={isAzure ? 'my-gpt5-deployment' : 'gpt-4o'} />
              </Field>

              {createModel.error && (
                <div style={{ marginBottom: 16 }}>
                  <Notice kind="error">{createModel.error.message}</Notice>
                </div>
              )}
            </FormCard>
          </Section>
        </div>
      )}
    </QueryState>
  );
}
