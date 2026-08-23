/**
 * Someone handed you a Gatehouse key. This is all it takes to use it.
 *
 *     GATEHOUSE_KEY=sk-... npx tsx developer/openai-sdk.ts
 *
 * Compare the constructor below with OpenAI's own quickstart: the difference is `baseURL` and
 * the key. No Gatehouse SDK, no wrapper, no request rewriting — Gatehouse is not in the request
 * path at all. You are talking to the LiteLLM proxy directly, and in exchange the operator gets
 * a model allow-list, a budget, and per-developer spend.
 *
 * Which models you may name is decided by the grants an admin set in Gatehouse, not by what you
 * type here. A model you were not granted — including one that does not exist — comes back as
 * 403 `key_model_access_denied`, because the proxy only knows what your key allows.
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

const completion = await client.chat.completions.create({
  model: process.env.GATEHOUSE_MODEL ?? 'gpt-4o',
  messages: [{ role: 'user', content: 'Say hello from the gateway.' }],
});

console.log('model ', completion.model);
console.log('reply ', completion.choices[0]?.message.content);
console.log('tokens', `${completion.usage?.prompt_tokens} in / ${completion.usage?.completion_tokens} out`);
