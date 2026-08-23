/**
 * The same key, the same proxy, the Anthropic wire protocol.
 *
 *     GATEHOUSE_KEY=sk-... npx tsx developer/anthropic-sdk.ts
 *
 * One key reaches both protocols. A developer does not get an "OpenAI key" and an "Anthropic
 * key" — they get a Gatehouse key, and the models it may name were chosen by an admin.
 *
 * Note the base URL has no `/v1` on it: the Anthropic SDK appends `/v1/messages` itself, while
 * the OpenAI SDK expects `/v1` to already be there. That is a vendor difference, not a
 * Gatehouse one. `GET /api/connect` reports both URLs if you would rather not guess.
 */
import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.GATEHOUSE_KEY;
if (!apiKey) {
  console.error('Set GATEHOUSE_KEY to a gateway key (an operator mints one with operator/onboard-developer.ts).');
  process.exit(1);
}

const client = new Anthropic({
  baseURL: process.env.GATEHOUSE_ANTHROPIC_URL ?? 'http://localhost:4000',
  apiKey,
});

const message = await client.messages.create({
  model: process.env.GATEHOUSE_ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
  max_tokens: 128,
  messages: [{ role: 'user', content: 'Say hello from the gateway.' }],
});

const [block] = message.content;
console.log('model ', message.model);
console.log('reply ', block?.type === 'text' ? block.text : `(${block?.type})`);
console.log('tokens', `${message.usage.input_tokens} in / ${message.usage.output_tokens} out`);
