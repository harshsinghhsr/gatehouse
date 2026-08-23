/**
 * Streaming through the gateway.
 *
 *     GATEHOUSE_KEY=sk-... npx tsx developer/streaming.ts
 *
 * The first question anyone asks about putting a proxy in front of an LLM is whether it breaks
 * streaming. It does not: LiteLLM relays server-sent events, so `stream: true` works exactly as
 * it does against the vendor, and the SDK's async iterator is unchanged.
 *
 * On the seeded development instance the models sit behind the MOCK provider, whose answers are
 * generated inside LiteLLM. Those DO stream — the fixed sentence arrives as a series of small
 * `chat.completion.chunk` deltas — but they arrive all at once, with none of the pacing a real
 * model has. So this proves the transport, not the latency.
 *
 * One real difference, and it is the vendor's, not the gateway's: a streamed OpenAI response
 * carries no `usage` block unless you ask for one. `stream_options: { include_usage: true }`
 * adds a final chunk with the token counts. Spend is metered either way — the proxy records the
 * call whether or not the client asked to see the numbers.
 */
import OpenAI from 'openai';

const apiKey = process.env.GATEHOUSE_KEY;
if (!apiKey) {
  console.error('Set GATEHOUSE_KEY to a gateway key (an operator mints one with operator/onboard-developer.ts).');
  process.exit(1);
}

const client = new OpenAI({
  baseURL: process.env.GATEHOUSE_OPENAI_URL ?? 'http://localhost:4000/v1',
  apiKey,
});

const stream = await client.chat.completions.create({
  model: process.env.GATEHOUSE_MODEL ?? 'gpt-4o',
  messages: [{ role: 'user', content: 'Say hello from the gateway.' }],
  stream: true,
  stream_options: { include_usage: true },
});

let chunks = 0;
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta.content;
  if (delta) {
    chunks += 1;
    process.stdout.write(delta);
  }
  if (chunk.usage) {
    process.stdout.write('\n');
    console.log('tokens', `${chunk.usage.prompt_tokens} in / ${chunk.usage.completion_tokens} out`);
  }
}
console.log('chunks', chunks);
