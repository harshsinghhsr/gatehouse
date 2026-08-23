/**
 * Replace a developer's key without a window where nothing works.
 *
 *     npx tsx operator/rotate-key.ts            # rotates newcomer@gatehouse.dev's oldest key
 *     GATEHOUSE_DEVELOPER=direct@gatehouse.dev npx tsx operator/rotate-key.ts
 *
 * Rotation mints the replacement first and only then kills the old key, so a leaked credential
 * is swapped out in one call. The old key is dead the moment this returns — every client still
 * holding it gets 401 `token_not_found_in_db` from the proxy, with no redeploy on our side.
 *
 * We cannot demonstrate that here, because Gatehouse does not keep the old plaintext either —
 * that is the design. `apps/api/test/integration/enforcement.test.ts` proves it, holding both
 * halves of the pair.
 */
import type {
  DeveloperDetail,
  DeveloperSummary,
  IssuedKey,
  LoginRequest,
  LoginResponse,
} from '../../packages/shared/src/index.js';

const API = process.env.GATEHOUSE_API_URL ?? 'http://localhost:3001/api';
const ADMIN_EMAIL = process.env.GATEHOUSE_ADMIN_EMAIL ?? 'owner@gatehouse.dev';
const ADMIN_PASSWORD = process.env.GATEHOUSE_ADMIN_PASSWORD ?? 'GatehouseDev!2026';
const TARGET = process.env.GATEHOUSE_DEVELOPER ?? 'newcomer@gatehouse.dev';

/** Rotating a key cuts off whoever holds it, so — like `scripts/seed-dev.ts` — localhost only. */
const host = new URL(API).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) || process.env.NODE_ENV === 'production') {
  console.error(`Refusing to run against ${API} (NODE_ENV=${process.env.NODE_ENV ?? 'unset'}).`);
  console.error('The operator examples revoke and rotate live credentials, so they are localhost only.');
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

const summary = (await api<DeveloperSummary[]>('GET', '/developers')).find((row) => row.email === TARGET);
if (!summary) {
  console.error(`No developer ${TARGET}. Run \`npx tsx operator/onboard-developer.ts\` first.`);
  process.exit(1);
}

const detail = await api<DeveloperDetail>('GET', `/developers/${summary.id}`);
const active = detail.keys.filter((key) => key.status === 'ACTIVE').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
const stale = active[0];
if (!stale) {
  console.error(`${TARGET} holds no active key to rotate. Run \`npx tsx operator/onboard-developer.ts\` first.`);
  process.exit(1);
}

console.log(`Rotating ${stale.keyPrefix} (${stale.keyAlias}), issued ${stale.createdAt}`);
const replacement = await api<IssuedKey>('POST', `/developers/${summary.id}/keys/${stale.id}/rotate`);

console.log(`\n${stale.keyPrefix} is now dead. Its replacement, shown once:\n`);
console.log(`  export GATEHOUSE_KEY=${replacement.key}`);
console.log(`\nThe replacement carries the same grants and draws on the same budget: the ceiling`);
console.log('belongs to the developer, so rotating does not hand anyone a fresh allowance.');
console.log("Spend already recorded against the old key stays on the dashboard — rotating is not erasing.");
