/**
 * 5. The feedback loop: read the spend back out of Gatehouse.
 *
 *     node 5-usage.mjs
 *
 * Traffic that went through a key issued in example 1 comes back here attributed to the person
 * that key belongs to. This is the reason for the whole exercise — the operator sees who spent
 * what, per model, without the developer ever having held a provider credential.
 *
 * Every figure originates in LiteLLM. Gatehouse asks the proxy and reformats; it never keeps a
 * price table of its own, and never recomputes a token cost.
 */
import { signIn, heading } from './gatehouse.mjs';

const api = await signIn();
const today = new Date().toISOString().slice(0, 10);
const range = `from=${process.env.GATEHOUSE_FROM ?? today}&to=${process.env.GATEHOUSE_TO ?? today}`;
const money = (value) => `$${value.toFixed(6)}`;

heading(`GET /api/usage?${range}`);
const totals = await api.get(`/usage?${range}`);
console.log('  spend            ', money(totals.spend));
console.log('  requests         ', totals.requests);
console.log('  tokens           ', `${totals.inputTokens} in / ${totals.outputTokens} out`);
console.log('  active developers', totals.activeDevelopers);
console.log('  active models    ', totals.activeModels);

heading(`GET /api/usage/developers?${range}`);
console.table(
  (await api.get(`/usage/developers?${range}`))
    .sort((a, b) => b.spend - a.spend)
    .map((row) => ({ developer: row.email, requests: row.requests, spend: money(row.spend) })),
);

heading(`GET /api/usage/models?${range}`);
console.table(
  (await api.get(`/usage/models?${range}`))
    .sort((a, b) => b.spend - a.spend)
    .map((row) => ({ model: row.name, requests: row.requests, spend: money(row.spend) })),
);

console.log('\nThe same numbers are on the dashboard at http://localhost:3000.');
console.log('\nA caveat for the mock provider only: LiteLLM v1.97 prices some mocked models at');
console.log('$0 even though the requests and tokens are real. Prefer an OpenAI-priced model');
console.log('(gpt-4o, o1-pro) when you want a dollar figure to look at.');
