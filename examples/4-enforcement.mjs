/**
 * 4. The interesting half: what happens when a call should be refused.
 *
 *     node 4-enforcement.mjs
 *
 * A key is only worth issuing if it stops working when it should. Each case below makes a change
 * in Gatehouse and then proves it at the gateway with a real request, printing the status code
 * and error body the caller actually gets back.
 *
 * Everything happens on a developer of its own — created here, never one of the seeded people —
 * so the run cannot leave your dashboard in a strange state. Keys are revoked and the developer
 * is re-enabled on the way out, and the whole script is safe to run twice.
 */
import { signIn, gatewayUrls, ApiError, heading } from './gatehouse.mjs';

const EMAIL = 'examples@gatehouse.dev';
const GRANTED = 'o1-pro';    // priced high enough that a budget can be driven over in a few calls
const UNGRANTED = 'gpt-4o-mini';

const api = await signIn();
const gateway = (await gatewayUrls(api)).openai;

/** One chat completion. Returns the status and whatever the gateway said, refusal or not. */
async function ask(key, model) {
  const response = await fetch(`${gateway}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Say hello.' }] }),
  });
  const text = await response.text();
  let error = null;
  try {
    error = JSON.parse(text).error ?? null;
  } catch {
    error = { type: 'unparsed', message: text.slice(0, 200) };
  }
  return {
    status: response.status,
    type: error?.type ?? 'ok',
    detail: error ? `${error.type}: ${error.message}` : 'ok',
    cost: Number(response.headers.get('x-litellm-response-cost') ?? 0),
  };
}

const results = [];
function report(name, why, outcome) {
  results.push({ case: name, status: outcome.status, error: outcome.type });
  console.log(`  ${why}`);
  console.log(`  -> HTTP ${outcome.status}  ${outcome.detail}\n`);
}

// ---------------------------------------------------------------------------------------------
// Setup: a developer of our own, granted exactly one model.
// ---------------------------------------------------------------------------------------------
let developer = (await api.get('/developers')).find((row) => row.email === EMAIL);
if (!developer) {
  developer = await api.post('/developers', { email: EMAIL, name: 'Eddie Examples', role: 'MEMBER' });
}
// Left over from an interrupted run? Put them back before we start.
await api.patch(`/developers/${developer.id}`, { status: 'ACTIVE' }).catch(() => {});

const models = await api.get('/models');
const granted = models.find((model) => model.publicModelName === GRANTED);
if (!granted) {
  console.error(`No model "${GRANTED}" in the catalogue. Run \`npm run seed\` from the repo root.`);
  process.exit(1);
}
await api.put(`/developers/${developer.id}/models`, { modelIds: [granted.id] });

const issue = () => api.post(`/developers/${developer.id}/keys`);
const revoke = (keyId) => api.post(`/developers/${developer.id}/keys/${keyId}/revoke`).catch(() => {});

console.log(`\nDeveloper ${EMAIL} may use exactly one model: ${GRANTED}\n`);

// ---------------------------------------------------------------------------------------------
heading('Case 1 - a model the developer was never granted');
console.log('  Why it matters: an allow-list on the key is what stops a developer reaching for');
console.log('  the expensive model nobody approved. It is enforced at the proxy, not in a client.\n');
const key1 = await issue();
report('ungranted model', `Calling ${UNGRANTED} with a key granted only ${GRANTED}`, await ask(key1.key, UNGRANTED));

// ---------------------------------------------------------------------------------------------
heading('Case 2 - a key revoked through Gatehouse');
console.log('  Why it matters: revocation is the offboarding story. Pressing revoke in the');
console.log('  dashboard has to kill the credential everywhere, immediately, with no deploy.\n');
console.log(`  Sanity check first: ${GRANTED} works before revoking.`);
const before = await ask(key1.key, GRANTED);
console.log(`  -> HTTP ${before.status}  cost $${before.cost}\n`);
await revoke(key1.id);
report('revoked key', 'Calling again after POST /developers/:id/keys/:keyId/revoke', await ask(key1.key, GRANTED));

// ---------------------------------------------------------------------------------------------
heading('Case 3 - a key that has been rotated');
console.log('  Why it matters: rotation mints the replacement first and only then kills the old');
console.log('  key, so a leaked credential can be replaced without a window of downtime.\n');
const old = await issue();
const replacement = await api.post(`/developers/${developer.id}/keys/${old.id}/rotate`);
const rotatedOld = await ask(old.key, GRANTED);
const rotatedNew = await ask(replacement.key, GRANTED);
report('rotated key (old)', 'Calling with the key that was rotated away', rotatedOld);
console.log(`  And the replacement issued by the same call: HTTP ${rotatedNew.status}\n`);
await revoke(replacement.id);

// ---------------------------------------------------------------------------------------------
heading('Case 4 - a disabled developer');
console.log('  Why it matters: disabling a person must not require hunting down their keys one');
console.log('  by one. Gatehouse revokes every active key as part of the status change.\n');
const key4 = await issue();
await api.patch(`/developers/${developer.id}`, { status: 'DISABLED' });
report('disabled developer', 'Calling with a key that was active when the developer was disabled', await ask(key4.key, GRANTED));
await api.patch(`/developers/${developer.id}`, { status: 'ACTIVE' });
console.log('  Developer re-enabled. Note their old keys stay revoked - re-enabling does not');
console.log('  resurrect a credential, they get a fresh one.\n');

// ---------------------------------------------------------------------------------------------
heading('Case 5 - a budget driven over its limit');
console.log('  Why it matters: a spend ceiling that is only a dashboard warning is not a control.');
console.log('  LiteLLM enforces it in the request path and refuses the call that would exceed it.\n');
const CEILING = 0.02;
await api.patch(`/developers/${developer.id}`, { budget: { maxBudget: CEILING, period: 'DAILY' } });
// The ceiling is attached to the key when it is minted, so this has to be a fresh one.
const key5 = await issue();
console.log(`  Budget $${CEILING} DAILY. Calling ${GRANTED} until the gateway says no.`);
let spent = 0;
let budgetOutcome = { status: 0, type: 'never refused', detail: `never refused in 20 calls` };
for (let attempt = 1; attempt <= 20; attempt += 1) {
  const outcome = await ask(key5.key, GRANTED);
  if (outcome.status !== 200) {
    budgetOutcome = outcome;
    console.log(`  call ${attempt}: refused after $${spent.toFixed(4)} of $${CEILING}`);
    break;
  }
  spent += outcome.cost;
  console.log(`  call ${attempt}: $${outcome.cost.toFixed(4)}  (running total $${spent.toFixed(4)})`);
}
report('budget exhausted', `Ceiling was $${CEILING}`, budgetOutcome);
await revoke(key5.id);
await api.patch(`/developers/${developer.id}`, { budget: { maxBudget: 100, period: 'MONTHLY' } });

// ---------------------------------------------------------------------------------------------
heading('Case 6 - the control plane refuses too');
console.log('  Why it matters: the guards are not only at the proxy. Gatehouse will not mint a');
console.log('  key for someone who is disabled, so there is no way to hand one out by accident.\n');
await api.patch(`/developers/${developer.id}`, { status: 'DISABLED' });
try {
  await issue();
  console.log('  -> a key was issued, which it should not have been\n');
  results.push({ case: 'issue key for disabled developer', status: 201, error: 'none (unexpected!)' });
} catch (error) {
  if (!(error instanceof ApiError)) throw error;
  console.log(`  -> HTTP ${error.status}  ${error.code}: ${error.message.split(': ').slice(1).join(': ')}\n`);
  results.push({ case: 'issue key for disabled developer', status: error.status, error: error.code });
}
await api.patch(`/developers/${developer.id}`, { status: 'ACTIVE' });

heading('Summary');
console.table(results);
console.log(`${EMAIL} is left ACTIVE with no live keys. Run again as often as you like.`);
