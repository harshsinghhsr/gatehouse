import { Link } from 'react-router-dom';
import { Empty, PageHead, QueryState, Table } from '../../shared/ui';
import { useModels, useSetModelEnabled } from './queries';

export function ModelsPage() {
  const models = useModels();
  const setEnabled = useSetModelEnabled();

  return (
    <div className="stack">
      <PageHead
        title="Models"
        description="A public name is what developers call. Inside the gateway each one is namespaced per organization, so two organizations can both publish gpt-5."
      />

      <QueryState isPending={models.isPending} error={models.error}>
        <Table head={['Public name', 'Provider', 'Upstream', 'Gateway name', 'State', '']}>
          {models.data?.length === 0 && <Empty>No models yet. Add one from a provider.</Empty>}
          {models.data?.map((model) => (
            <tr key={model.id}>
              <td className="mono">{model.publicModelName}</td>
              <td>
                <Link to={`/providers/${model.provider.id}`}>{model.provider.name}</Link>
              </td>
              <td className="mono muted">{model.providerModelName}</td>
              <td className="mono muted">{model.gatewayModelName}</td>
              <td>{model.enabled ? 'Live' : 'Disabled'}</td>
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
      </QueryState>
    </div>
  );
}
