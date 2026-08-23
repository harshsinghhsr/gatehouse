import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { LiteLlmGateway } from '../../src/infra/litellm/litellm-gateway.js';
import { ScryptPasswordHasher } from '../../src/modules/auth/password.js';
import { hostUrl } from '../support/stack-env.js';

/**
 * Every way a call gets refused, against a real stack: docker compose up, then
 * INTEGRATION=1 npm run -w apps/api test.
 *
 * A key you cannot take away is not a credential, it is a liability, so these are the assertions
 * that matter most and the ones a reader is most likely to want to see fail. The status codes
 * below are documented for humans in examples/README.md; this file is their executable proof.
 *
 * Everything runs on fixtures of its own — a throwaway owner, provider, two models and one
 * developer, all stamped with the clock and deleted afterwards — so it never disables a seeded
 * account and is safe to run as often as you like. The models are registered with LiteLLM's
 * mock_response, so no vendor credential is involved, but LiteLLM still prices the tokens, which
 * is what makes the budget case reach a real ceiling.
 */

const API = process.env.API_URL ?? 'http://localhost:3001';
const GATEWAY = hostUrl(process.env.LITELLM_URL ?? process.env.LITELLM_BASE_URL ?? 'http://localhost:4000');
const DATABASE_URL = hostUrl(
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/gateway',
);
const MASTER_KEY = process.env.LITELLM_MASTER_KEY ?? 'sk-dev-master-key-change-me';

/** Priced high enough by LiteLLM's own table that a few mocked calls cross a small ceiling. */
const GRANTED_UPSTREAM = 'openai/o1-pro';
const UNGRANTED_UPSTREAM = 'openai/gpt-4o-mini';
const CEILING = 0.02;

const enabled = process.env.INTEGRATION === '1';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
const hasher = new ScryptPasswordHasher();
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const gateway = new LiteLlmGateway({ baseUrl: GATEWAY, masterKey: MASTER_KEY, logger: silentLogger });

const stamp = Date.now();
const slug = `enforce-${stamp}`;
const ownerEmail = `enforce-owner-${stamp}@example.test`;
const developerEmail = `enforce-dev-${stamp}@example.test`;
const password = 'integration-test-password';

let ownerId = '';
let providerId = '';
let developerId = '';
const litellmModelIds: string[] = [];
const granted = { id: '', name: 'granted' };
const ungranted = { id: '', name: 'ungranted' };
let cookie = '';

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0] ?? cookie;
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

/** One chat completion straight at the gateway — the only thing a developer's client ever does. */
async function ask(key: string, model: string) {
  const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }] }),
  });
  const text = await res.text();
  let type = 'ok';
  try {
    type = ((JSON.parse(text) as { error?: { type?: string } }).error?.type ?? 'ok') as string;
  } catch {
    type = 'unparsed';
  }
  return { status: res.status, type, body: text.slice(0, 300) };
}

const issueKey = async () => {
  const created = await api('POST', `/api/developers/${developerId}/keys`);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body as unknown as { id: string; key: string };
};

const setStatus = (status: 'ACTIVE' | 'DISABLED') => api('PATCH', `/api/developers/${developerId}`, { status });

async function registerMockModel(publicModelName: string, upstream: string) {
  const litellmModelName = `${slug}/${publicModelName}`;
  const litellmModelId = await gateway.registerModel(litellmModelName, {
    model: upstream,
    api_key: 'not-used-by-mock',
    mock_response: `mock ${publicModelName}`,
  });
  litellmModelIds.push(litellmModelId);
  const row = await prisma.providerModel.create({
    data: {
      providerId,
      publicModelName,
      providerModelName: upstream,
      litellmModelName,
      litellmModelId,
    },
  });
  return row.id;
}

before(async () => {
  if (!enabled) return;

  const owner = await prisma.user.create({
    data: { email: ownerEmail, name: 'Enforcement Owner', passwordHash: await hasher.hash(password), role: 'OWNER' },
  });
  ownerId = owner.id;

  const provider = await prisma.provider.create({
    data: { name: `Enforcement ${stamp}`, slug, type: 'OPENAI', secretRef: `test://${stamp}` },
  });
  providerId = provider.id;

  granted.id = await registerMockModel(granted.name, GRANTED_UPSTREAM);
  ungranted.id = await registerMockModel(ungranted.name, UNGRANTED_UPSTREAM);

  const login = await api('POST', '/api/auth/login', { email: ownerEmail, password });
  assert.equal(login.status, 200, JSON.stringify(login.body));

  const created = await api('POST', '/api/developers', {
    email: developerEmail,
    name: 'Enforcement Developer',
    role: 'MEMBER',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  developerId = (created.body as unknown as { id: string }).id;

  // Exactly one of the two models, so the other is a genuine ungranted name.
  const grant = await api('PUT', `/api/developers/${developerId}/models`, { modelIds: [granted.id] });
  assert.equal(grant.status, 200, JSON.stringify(grant.body));
});

after(async () => {
  if (!enabled) return;
  // Deleting through the API takes the developer's gateway keys with them; the fixtures below
  // never existed for anyone else, so nothing seeded is touched either way.
  if (developerId) {
    await setStatus('ACTIVE').catch(() => undefined);
    await api('DELETE', `/api/developers/${developerId}`).catch(() => undefined);
  }
  await prisma.provider.deleteMany({ where: { id: providerId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  for (const id of litellmModelIds) await gateway.deregisterModel(id).catch(() => undefined);
  await prisma.$disconnect();
});

/**
 * The cases below run in order and hand each other keys, which is not the usual courtesy but is
 * forced by a real product constraint: POST /developers/:id/keys is rate limited to 20 a minute
 * per IP, and a suite that mints a fresh key per assertion cannot be run twice in a row.
 */
let live: { id: string; key: string };

test('a model the developer was never granted is refused by the proxy', { skip: !enabled }, async () => {
  live = await issueKey();

  assert.equal((await ask(live.key, granted.name)).status, 200, 'the granted model must work first');

  const refused = await ask(live.key, ungranted.name);
  assert.equal(refused.status, 403, refused.body);
  assert.equal(refused.type, 'key_model_access_denied');

  // The allow-list lives on the key, and Gatehouse never sees the request, so the proxy cannot
  // tell "a model you were not granted" from "a model nobody ever published". Both are 403,
  // never 404 — the single most confusing thing for a new user.
  const nonsense = await ask(live.key, `no-such-model-${stamp}`);
  assert.equal(nonsense.status, 403, nonsense.body);
  assert.equal(nonsense.type, 'key_model_access_denied');
});

test('a revoked key stops working immediately', { skip: !enabled }, async () => {
  const revoked = await api('POST', `/api/developers/${developerId}/keys/${live.id}/revoke`);
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));

  const refused = await ask(live.key, granted.name);
  assert.equal(refused.status, 401, refused.body);
  assert.equal(refused.type, 'token_not_found_in_db');
});

test('rotation kills the old key and the replacement works', { skip: !enabled }, async () => {
  const original = await issueKey();

  const rotated = await api('POST', `/api/developers/${developerId}/keys/${original.id}/rotate`);
  assert.equal(rotated.status, 200, JSON.stringify(rotated.body));
  const replacement = rotated.body as unknown as { id: string; key: string };
  assert.notEqual(replacement.key, original.key);

  const dead = await ask(original.key, granted.name);
  assert.equal(dead.status, 401, dead.body);
  assert.equal(dead.type, 'token_not_found_in_db');

  // The replacement is minted before the old key dies, so there is no window with no credential.
  assert.equal((await ask(replacement.key, granted.name)).status, 200);
  live = replacement;
});

test('disabling a developer revokes every key they hold', { skip: !enabled }, async () => {
  const second = await issueKey();
  assert.equal((await ask(second.key, granted.name)).status, 200);

  const disabled = await setStatus('DISABLED');
  assert.equal(disabled.status, 200, JSON.stringify(disabled.body));

  // Both of them: disabling a person must not mean hunting down their keys one at a time.
  for (const key of [live, second]) {
    const refused = await ask(key.key, granted.name);
    assert.equal(refused.status, 401, refused.body);
    assert.equal(refused.type, 'token_not_found_in_db');
  }

  // Re-enabling does not resurrect a credential: they stay revoked and the developer gets a
  // fresh one. Worth knowing before you disable someone.
  assert.equal((await setStatus('ACTIVE')).status, 200);
  const stillDead = await ask(live.key, granted.name);
  assert.equal(stillDead.status, 401, stillDead.body);
});

test('Gatehouse refuses to issue a key to a disabled developer', { skip: !enabled }, async () => {
  assert.equal((await setStatus('DISABLED')).status, 200);

  const refused = await api('POST', `/api/developers/${developerId}/keys`);
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal((refused.body?.error as { code?: string } | undefined)?.code, 'conflict');

  assert.equal((await setStatus('ACTIVE')).status, 200);
});

test('the budget is the developer\u2019s, not the key\u2019s', { skip: !enabled }, async () => {
  const budget = await api('PATCH', `/api/developers/${developerId}`, {
    budget: { maxBudget: CEILING, period: 'DAILY' },
  });
  assert.equal(budget.status, 200, JSON.stringify(budget.body));

  const first = await issueKey();

  // The cases above already spent some of this developer's allowance, and LiteLLM writes spend
  // on a batch interval, so the refusal lands a call or two after the spend that earned it.
  // Calling until it refuses is the honest way to observe either.
  let refusal = { status: 0, type: 'never refused', body: '' };
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const outcome = await ask(first.key, granted.name);
    if (outcome.status !== 200) {
      refusal = outcome;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(refusal.status, 429, `expected the ceiling to bite: ${refusal.type} ${refusal.body}`);
  assert.equal(refusal.type, 'budget_exceeded');

  // The point of the case: a second key does not come with a second allowance. The ceiling is
  // pushed to the developer's mirrored gateway user, so every key they hold spends the same one.
  const second = await issueKey();
  const alsoRefused = await ask(second.key, granted.name);
  assert.equal(alsoRefused.status, 429, `a fresh key must not reset the ceiling: ${alsoRefused.body}`);
});
