import { useState } from 'react';
import { formatDate } from '../../shared/lib/format';
import { Code, Empty, PageHead, QueryState, Section, Table } from '../../shared/ui';
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
              <Section title="OpenAI base URL">
                <Code>{connect.data.openai.baseUrl}</Code>
              </Section>
              <Section title="Anthropic base URL">
                <Code>{connect.data.anthropic.baseUrl}</Code>
              </Section>
            </div>

            <Section title="Models you can call" description="Pick one to rewrite the snippets below.">
              <div className="card card-pad row">
                {connect.data.models.length === 0 && (
                  <span className="muted">No models granted yet. An admin can grant them.</span>
                )}
                {connect.data.models.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={name === model ? 'primary small' : 'small'}
                    aria-pressed={name === model}
                    onClick={() => setChosen(name)}
                  >
                    <span className="mono" style={{ fontSize: 12 }}>
                      {name}
                    </span>
                  </button>
                ))}
              </div>
            </Section>

            <div className="grid grid-half">
              <Section title="OpenAI SDK">
                <Code>{openAiSnippet(connect.data.openai.baseUrl, model)}</Code>
              </Section>
              <Section title="Anthropic SDK">
                <Code>{anthropicSnippet(connect.data.anthropic.baseUrl, model)}</Code>
              </Section>
            </div>

            <Section title="Your keys">
              <Table head={['Key', 'Created']}>
                {connect.data.keys.length === 0 && (
                  <Empty title="No active key">An admin can issue one for you from your developer page.</Empty>
                )}
                {connect.data.keys.map((key) => (
                  <tr key={key.id}>
                    <td className="mono">{key.keyPrefix ?? '—'}</td>
                    <td className="muted">{formatDate(key.createdAt)}</td>
                  </tr>
                ))}
              </Table>
            </Section>
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
