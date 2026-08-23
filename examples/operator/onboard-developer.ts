/**
 * The whole operator workflow in one file: sign in, create a developer, grant them models, give
 * them a budget, mint their key, print what to hand over.
 *
 *     npx tsx operator/onboard-developer.ts
 *
 * This is what the dashboard does when you click through the same five screens. Every call goes
 * to the ordinary public HTTP API — there is no private back door and no Gatehouse client
 * library, which is the point. Re-running it reuses the developer it already made.
 *
 * The types come from `packages/shared` by relative path, so this file is checked against the
 * same zod contract the API and the dashboard compile against. If a payload changes, this stops
 * compiling instead of silently drifting.
 */
import type {
  CreateDeveloperRequest,
  DeveloperDetail,
  DeveloperSummary,
  IssuedKey,
  LoginRequest,
  LoginResponse,
  Model,
  SetModelAccessRequest,
  UpdateDeveloperRequest,
} from '../../packages/shared/src/index.js';

const API = process.env.GATEHOUSE_API_URL ?? 'http://localhost:3001/api';
const ADMIN_EMAIL = process.env.GATEHOUSE_ADMIN_EMAIL ?? 'owner@gatehouse.dev';
const ADMIN_PASSWORD = process.env.GATEHOUSE_ADMIN_PASSWORD ?? 'GatehouseDev!2026';
const NEW_EMAIL = process.env.GATEHOUSE_NEW_DEVELOPER ?? 'newcomer@gatehouse.dev';
const GRANT = (process.env.GATEHOUSE_GRANT ?? 'gpt-4o,claude-sonnet-4-5').split(',');

/**
 * This script creates people and mints credentials, and its default password is the seed's
 * development one. Exactly like `scripts/seed-dev.ts`, it refuses to run anywhere but a local
 * development instance.
 */
const host = new URL(API).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) || process.env.NODE_ENV === 'production') {
  console.error(`Refusing to run against ${API} (NODE_ENV=${process.env.NODE_ENV ?? 'unset'}).`);
  console.error('The operator examples create developers and issue keys, so they are localhost only.');
  process.exit(1);
}

/** One signed-in browser. The session cookie is httpOnly, so we carry it by hand. */
let cookie = '';
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const setCookie = response.headers.getSetCookie().find((value) => value.startsWith('gw_session='));
  if (setCookie) cookie = setCookie.split(';')[0] ?? cookie;

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, never>) : ({} as Record<string, never>);
  if (!response.ok) {
    const error = (payload.error ?? {}) as { code?: string; message?: string };
    throw new Error(`${method} ${path} -> ${response.status} ${error.code ?? ''}: ${error.message ?? text}`);
  }
  return payload as T;
}

// 1. Sign in as an admin.
const login: LoginRequest = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
const session = await api<LoginResponse>('POST', '/auth/login', login);
console.log(`Signed in as ${session.user.email}`);

// 2. Create the developer. No password: someone who only ever uses a key never signs into the
//    dashboard, so they do not need one.
const existing = (await api<DeveloperSummary[]>('GET', '/developers')).find((row) => row.email === NEW_EMAIL);
const create: CreateDeveloperRequest = { email: NEW_EMAIL, name: 'Nina Newcomer', role: 'MEMBER' };
const developer = existing ?? (await api<DeveloperSummary>('POST', '/developers', create));
console.log(`${existing ? 'Reusing' : 'Created'} developer ${developer.name} <${developer.email}>`);

// 3. Grant models by name. The catalogue is what an admin has published; the developer can only
//    ever name something on this list, and the allow-list is enforced at the proxy.
const catalogue = await api<Model[]>('GET', '/models');
const granted = catalogue.filter((model) => model.enabled && GRANT.includes(model.publicModelName));
if (granted.length === 0) {
  console.error(`None of ${GRANT.join(', ')} are in the catalogue. Run \`npm run seed\` from the repo root.`);
  process.exit(1);
}
const access: SetModelAccessRequest = { modelIds: granted.map((model) => model.id) };
await api('PUT', `/developers/${developer.id}/models`, access);
console.log(`Granted ${granted.map((model) => model.publicModelName).join(', ')}`);

// 4. Set a ceiling. The budget belongs to the developer, not to a key: every key they hold
//    spends against this one allowance, and LiteLLM refuses the call that would exceed it.
const budget: UpdateDeveloperRequest = { budget: { maxBudget: 25, period: 'MONTHLY', rpmLimit: 60 } };
await api('PATCH', `/developers/${developer.id}`, budget);
console.log('Budget $25 MONTHLY, 60 rpm');

// 5. Mint the key. The plaintext comes back exactly once, in this response, and Gatehouse never
//    stores it — the database keeps an alias, a LiteLLM token id, and a masked prefix. The
//    developer never sees a provider credential: the real vendor key stays in the secret store.
const issued = await api<IssuedKey>('POST', `/developers/${developer.id}/keys`);

const detail = await api<DeveloperDetail>('GET', `/developers/${developer.id}`);
console.log(`\nHand this to ${developer.email} — it is shown once and cannot be recovered:\n`);
console.log(`  export GATEHOUSE_KEY=${issued.key}`);
console.log(`  export GATEHOUSE_OPENAI_URL=http://localhost:4000/v1`);
console.log(`\n  models  ${detail.models.map((model) => model.publicModelName).join(', ')}`);
console.log(`  budget  $${detail.budget?.maxBudget} ${detail.budget?.period}`);
console.log(`  key     ${issued.keyPrefix} (all Gatehouse keeps of it), ${detail.keys.length} on record`);
console.log('\nThen:  npx tsx developer/openai-sdk.ts');
console.log(`Revoke it any time: POST /api/developers/${developer.id}/keys/${issued.id}/revoke`);
