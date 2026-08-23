import { Link } from 'react-router-dom';
import { Badge, Empty, Notice, PageHead, QueryState, Table } from '../../shared/ui';
import { useModels, useSetModelEnabled } from './queries';

export function ModelsPage() {
  const models = useModels();
  const setEnabled = useSetModelEnabled();

  return (
    <div className="stack">
      <PageHead
        title="Models"
        description="A public name is what developers call. Inside the gateway each one is namespaced per provider, so two providers can both publish gpt-5."
      />

      <QueryState isPending={models.isPending} error={models.error}>
        <div className="stack">
          <Table head={['Public name', 'Provider', 'Upstream', 'Gateway name', 'State', '']}>
            {models.data?.length === 0 && (
              <Empty
                title="No models yet"
                action={
                  <Link className="btn small" to="/providers">
                    Open a provider
                  </Link>
                }
              >
                Models are added from the provider that serves them.
              </Empty>
            )}
            {models.data?.map((model) => (
              <tr key={model.id}>
                <td className="mono">{model.publicModelName}</td>
                <td>
                  <Link to={`/providers/${model.provider.id}`}>{model.provider.name}</Link>
                </td>
                <td className="mono muted">{model.providerModelName}</td>
                <td className="mono muted">{model.gatewayModelName}</td>
                <td>
                  <Badge tone={model.enabled ? 'ok' : 'neutral'}>{model.enabled ? 'Live' : 'Disabled'}</Badge>
                </td>
                <td className="num">
                  <button
                    type="button"
                    className="small"
                    disabled={setEnabled.isPending}
                    onClick={() => setEnabled.mutate({ id: model.id, enabled: !model.enabled })}
                  >
                    {model.enabled ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </Table>

          {/* Enabling a model can be refused — by the gateway or by authority. Without this
              the button simply flipped nothing. */}
          {setEnabled.error && <Notice kind="error">{setEnabled.error.message}</Notice>}
        </div>
      </QueryState>
    </div>
  );
}
