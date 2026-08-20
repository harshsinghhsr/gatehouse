import { useState } from 'react';
import { formatDate } from '../../shared/lib/format';
import { Empty, PageHead, QueryState, Table } from '../../shared/ui';
import { useConnectInfo } from '../usage/queries';

/** Everything a developer needs to point an SDK at the gateway, with their own models filled in. */
export function ConnectPage() {
  const connect = useConnectInfo();
  const [chosen, setChosen] = useState<string | null>(null);
  const model = chosen ?? connect.data?.models[0] ?? 'gpt-5';

  return (
    <div className="stack">
      <PageHead
        title="Connect"
        description="Point any OpenAI or Anthropic SDK at the gateway. Only the key and the base URL change — no provider credential is ever involved."
      />

      <QueryState isPending={connect.isPending} error={connect.error}>
        {connect.data && (
          <>
            <div className="grid grid-half">
              <div className="card card-pad">
                <div className="stat-label">OpenAI base URL</div>
                <pre style={{ marginTop: 8 }}>{connect.data.openai.baseUrl}</pre>
              </div>
              <div className="card card-pad">
                <div className="stat-label">Anthropic base URL</div>
                <pre style={{ marginTop: 8 }}>{connect.data.anthropic.baseUrl}</pre>
              </div>
            </div>

            <section>
              <h2>Your keys</h2>
              <Table head={['Key', 'Created']}>
                {connect.data.keys.length === 0 && (
                  <Empty>You have no active key. An admin can issue one for you.</Empty>
                )}
                {connect.data.keys.map((key) => (
                  <tr key={key.id}>
                    <td className="mono">{key.keyPrefix ?? '—'}</td>
                    <td className="mono muted">{formatDate(key.createdAt)}</td>
                  </tr>
                ))}
              </Table>
            </section>

            <section>
              <h2>Models you can call</h2>
              <div className="card card-pad row">
                {connect.data.models.length === 0 && <span className="muted">No models granted yet.</span>}
                {connect.data.models.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={name === model ? 'primary small' : 'small'}
                    onClick={() => setChosen(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </section>

            <div className="grid grid-half">
              <section>
                <h2>OpenAI SDK</h2>
                <pre>{openAiSnippet(connect.data.openai.baseUrl, model)}</pre>
              </section>
              <section>
                <h2>Anthropic SDK</h2>
                <pre>{anthropicSnippet(connect.data.anthropic.baseUrl, model)}</pre>
              </section>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}

const openAiSnippet = (baseUrl: string, model: string) => `from openai import OpenAI

client = OpenAI(
    api_key="YOUR_GATEWAY_KEY",
    base_url="${baseUrl}",
)

response = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello"}],
)`;

const anthropicSnippet = (baseUrl: string, model: string) => `from anthropic import Anthropic

client = Anthropic(
    api_key="YOUR_GATEWAY_KEY",
    base_url="${baseUrl}",
)

message = client.messages.create(
    model="${model}",
    max_tokens=1000,
    messages=[{"role": "user", "content": "Hello"}],
)`;
