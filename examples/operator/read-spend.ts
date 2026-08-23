/**
 * The feedback loop: who spent what, per developer and per model.
 *
 *     npx tsx operator/read-spend.ts
 *     GATEHOUSE_FROM=2026-08-01 GATEHOUSE_TO=2026-08-31 npx tsx operator/read-spend.ts
 *
 * This is the reason for issuing keys through a control plane instead of sharing one provider
 * credential: traffic comes back attributed to the person whose key made it, without that
 * person ever having held a vendor key.
 *
 * Every figure originates in LiteLLM. Gatehouse asks the proxy and reformats; it keeps no price
 * table of its own and never recomputes a token cost. The same numbers are on the dashboard at
 * http://localhost:3000.
 *
 * Read-only — but it signs in with the seed's development password, so it keeps the same
 * localhost guard as the rest of this folder.
 */
import type {
  DeveloperUsageRow,
  LoginRequest,
  LoginResponse,
  UsageBreakdownRow,
  UsageTotals,
} from '../../packages/shared/src/index.js';

const API = process.env.GATEHOUSE_API_URL ?? 'http://localhost:3001/api';
const ADMIN_EMAIL = process.env.GATEHOUSE_ADMIN_EMAIL ?? 'owner@gatehouse.dev';
const ADMIN_PASSWORD = process.env.GATEHOUSE_ADMIN_PASSWORD ?? 'GatehouseDev!2026';

const host = new URL(API).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) || process.env.NODE_ENV === 'production') {
  console.error(`Refusing to run against ${API} (NODE_ENV=${process.env.NODE_ENV ?? 'unset'}).`);
  console.error('The operator examples sign in with the development seed password, so they are localhost only.');
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

const login: LoginRequest = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
await api<LoginResponse>('POST', '/auth/login', login);

const today = new Date().toISOString().slice(0, 10);
const range = `from=${process.env.GATEHOUSE_FROM ?? today}&to=${process.env.GATEHOUSE_TO ?? today}`;
const money = (value: number) => `$${value.toFixed(6)}`;

const totals = await api<UsageTotals>('GET', `/usage?${range}`);
console.log(`GET /api/usage?${range}`);
console.log('  spend            ', money(totals.spend));
console.log('  requests         ', `${totals.requests} served, ${totals.failedRequests} refused`);
console.log('  tokens           ', `${totals.inputTokens} in / ${totals.outputTokens} out`);
console.log('  active developers', totals.activeDevelopers);
console.log('  active models    ', totals.activeModels);

console.log(`\nGET /api/usage/developers?${range}`);
const developers = await api<DeveloperUsageRow[]>('GET', `/usage/developers?${range}`);
console.table(
  developers
    .sort((a, b) => b.spend - a.spend)
    .map((row) => ({ developer: row.email, requests: row.requests, spend: money(row.spend) })),
);

console.log(`GET /api/usage/models?${range}`);
const models = await api<UsageBreakdownRow[]>('GET', `/usage/models?${range}`);
console.table(
  models.sort((a, b) => b.spend - a.spend).map((row) => ({ model: row.name, requests: row.requests, spend: money(row.spend) })),
);

console.log('A caveat that belongs to the mock provider, not the product: LiteLLM v1.97 prices');
console.log('some mocked models at $0 even though their requests and token counts are real.');
console.log('Prefer an OpenAI-priced model (gpt-4o, o1-pro) when you want a dollar figure.');
