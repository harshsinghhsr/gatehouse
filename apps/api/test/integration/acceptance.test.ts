import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { LiteLlmGateway } from '../../src/infra/litellm/litellm-gateway.js';
import { ScryptPasswordHasher } from '../../src/modules/auth/password.js';
import { hostUrl } from '../support/stack-env.js';

/**
 * The MVP acceptance flow (PLAN.md §48) against a real stack: docker compose up, then
 * INTEGRATION=1 npm run -w apps/api test.
 *
 * The model is registered with LiteLLM's mock_response, so this never calls a real provider
 * and never needs a real credential. Provider onboarding itself is covered by unit tests.
 */

const API = process.env.API_URL ?? 'http://localhost:3001';
const GATEWAY = hostUrl(process.env.LITELLM_URL ?? process.env.LITELLM_BASE_URL ?? 'http://localhost:4000');
const DATABASE_URL = hostUrl(
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/gateway',
);
const MASTER_KEY = process.env.LITELLM_MASTER_KEY ?? 'sk-dev-master-key-change-me';
const MOCK_REPLY = 'hello from the mock provider';

const enabled = process.env.INTEGRATION === '1';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
const hasher = new ScryptPasswordHasher();
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const gateway = new LiteLlmGateway({ baseUrl: GATEWAY, masterKey: MASTER_KEY, logger: silentLogger });

const stamp = Date.now();
const email = `dev-${stamp}@example.test`;
const password = 'integration-test-password';
const slug = `acme-${stamp}`;

let organizationId = '';
let userId = '';
let modelId = '';
let litellmModelId = '';
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

before(async () => {
  if (!enabled) return;

  // Seed the tenant directly: sign-up is bootstrap-only by design.
  const org = await prisma.organization.create({ data: { name: `Acme ${stamp}`, slug } });
  const user = await prisma.user.create({
    data: { email, name: 'Integration Dev', passwordHash: await hasher.hash(password) },
  });
  await prisma.membership.create({ data: { organizationId: org.id, userId: user.id, role: 'OWNER' } });
  organizationId = org.id;
  userId = user.id;

  // A model that answers without a provider credential.
  const litellmModelName = `${slug}/gpt-5`;
  litellmModelId = await gateway.registerModel(litellmModelName, {
    model: 'openai/gpt-4o',
    api_key: 'not-used-by-mock',
    mock_response: MOCK_REPLY,
  });
  const provider = await prisma.provider.create({
    data: { organizationId: org.id, name: 'Mock', type: 'OPENAI', secretRef: `test://${stamp}` },
  });
  const model = await prisma.providerModel.create({
    data: {
      providerId: provider.id,
      publicModelName: 'gpt-5',
      providerModelName: 'gpt-4o',
      litellmModelName,
      litellmModelId,
    },
  });
  modelId = model.id;
});

after(async () => {
  if (!enabled) return;
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await gateway.deregisterModel(litellmModelId).catch(() => undefined);
  await prisma.$disconnect();
});

test('acceptance: login, grant a model, mint a key, call the gateway, revoke', { skip: !enabled }, async () => {
  const login = await api('POST', '/api/auth/login', { email, password });
  assert.equal(login.status, 200, JSON.stringify(login.body));

  const me = await api('GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body?.activeOrganizationId, organizationId);

  const grant = await api('PUT', `/api/developers/${userId}/models`, { modelIds: [modelId] });
  assert.equal(grant.status, 200, JSON.stringify(grant.body));

  const created = await api('POST', `/api/developers/${userId}/keys`);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const { id: keyId, key } = created.body as unknown as { id: string; key: string };
  assert.match(key, /^sk-/);

  // The plaintext key must never be readable afterwards.
  const stored = await prisma.gatewayKeyReference.findUniqueOrThrow({ where: { id: keyId } });
  assert.ok(!JSON.stringify(stored).includes(key));

  // Developers use the public name; LiteLLM resolves the alias to "{org}/gpt-5".
  const call = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }] }),
  });
  const completionBody = await call.text();
  assert.equal(call.status, 200, completionBody);
  const completion = JSON.parse(completionBody) as { choices: Array<{ message: { content: string } }> };
  assert.match(completion.choices[0]?.message.content ?? '', new RegExp(MOCK_REPLY));

  const revoked = await api('POST', `/api/developers/${userId}/keys/${keyId}/revoke`);
  assert.equal(revoked.status, 200);

  const afterRevoke = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }] }),
  });
  assert.equal(afterRevoke.status, 401);
});

test('a model the developer was never granted is not callable', { skip: !enabled }, async () => {
  // Reuses the session from the previous test: logins are rate limited per account.
  await api('PUT', `/api/developers/${userId}/models`, { modelIds: [] });

  const created = await api('POST', `/api/developers/${userId}/keys`);
  assert.equal(created.status, 201);
  const { key } = created.body as unknown as { key: string };

  const call = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }] }),
  });
  assert.ok(call.status === 401 || call.status === 400, `expected a rejection, got ${call.status}`);
});

test('another organization cannot touch our developer', { skip: !enabled }, async () => {
  const otherOrg = await prisma.organization.create({
    data: { name: `Other ${stamp}`, slug: `other-${stamp}` },
  });
  const otherUser = await prisma.user.create({
    data: {
      email: `other-${stamp}@example.test`,
      name: 'Outsider',
      passwordHash: await hasher.hash(password),
    },
  });
  await prisma.membership.create({
    data: { organizationId: otherOrg.id, userId: otherUser.id, role: 'OWNER' },
  });

  cookie = '';
  await api('POST', '/api/auth/login', { email: `other-${stamp}@example.test`, password });

  assert.equal((await api('GET', `/api/developers/${userId}`)).status, 404);
  assert.equal((await api('POST', `/api/developers/${userId}/keys`)).status, 404);
  assert.equal((await api('PUT', `/api/developers/${userId}/models`, { modelIds: [modelId] })).status, 404);

  await prisma.organization.delete({ where: { id: otherOrg.id } });
  await prisma.user.delete({ where: { id: otherUser.id } });
  cookie = '';
});
