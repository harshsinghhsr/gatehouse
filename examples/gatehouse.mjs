/**
 * Shared plumbing for the examples: the safety guard, a signed-in API client, and the two
 * gateway base URLs. Nothing here is Gatehouse-specific machinery you would need in your own
 * code — it is the same session cookie and JSON handling a browser does for the dashboard.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BASE_URL = process.env.GATEHOUSE_API_URL ?? 'http://localhost:3001/api';
export const ADMIN_EMAIL = process.env.GATEHOUSE_ADMIN_EMAIL ?? 'owner@gatehouse.dev';
export const ADMIN_PASSWORD = process.env.GATEHOUSE_ADMIN_PASSWORD ?? 'GatehouseDev!2026';

/** Where example 1 leaves the plaintext key for the later examples. Gitignored, never committed. */
export const KEY_FILE = fileURLToPath(new URL('.gatehouse-key', import.meta.url));
/**
 * The admin session, cached between scripts. Not an optimisation: `POST /auth/login` is limited
 * to five attempts per quarter hour, and running six examples back to back would trip it.
 * Reusing the cookie is also what a browser does, so it exercises the same path.
 */
export const SESSION_FILE = fileURLToPath(new URL('.gatehouse-session', import.meta.url));

/**
 * These examples revoke keys and disable developers. Pointing them at a real deployment would
 * cut people off, so — exactly as `scripts/seed-dev.ts` does — they only run against localhost.
 */
{
  const host = new URL(BASE_URL).hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (!local || process.env.NODE_ENV === 'production') {
    console.error(`Refusing to run against ${BASE_URL} (NODE_ENV=${process.env.NODE_ENV ?? 'unset'}).`);
    console.error('These examples revoke keys and disable developers, so they are localhost only.');
    process.exit(1);
  }
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** One signed-in dashboard session. The session cookie is httpOnly, so we carry it by hand. */
export class Api {
  #cookie = null;

  constructor(cookie = null) {
    this.#cookie = cookie;
  }

  get cookie() {
    return this.#cookie;
  }

  async call(method, path, body) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(this.#cookie ? { cookie: this.#cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith('gw_session='));
    if (setCookie) this.#cookie = setCookie.split(';')[0];

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = payload.error ?? {};
      throw new ApiError(response.status, error.code ?? 'error', `${method} ${path}: ${error.message ?? text}`);
    }
    return payload;
  }

  get = (path) => this.call('GET', path);
  post = (path, body) => this.call('POST', path, body);
  put = (path, body) => this.call('PUT', path, body);
  patch = (path, body) => this.call('PATCH', path, body);
}

/** Signs in as an admin and returns the client plus the gateway URLs the dashboard advertises. */
export async function signIn() {
  let cached = null;
  try {
    cached = readFileSync(SESSION_FILE, 'utf8').trim();
  } catch {
    // No cached session yet; sign in below.
  }

  if (cached) {
    const api = new Api(cached);
    try {
      await api.get('/me');
      return api;
    } catch {
      rmSync(SESSION_FILE, { force: true });
    }
  }

  const api = new Api();
  try {
    await api.post('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  } catch (error) {
    console.error(`Could not sign in as ${ADMIN_EMAIL}: ${error.message}`);
    console.error('Is the dev stack up (`docker compose up`) and seeded (`npm run seed`)?');
    process.exit(1);
  }
  writeFileSync(SESSION_FILE, api.cookie, { mode: 0o600 });
  return api;
}

/**
 * The gateway's own base URLs, read from Gatehouse rather than hard-coded: an operator who moves
 * the proxy changes one setting and every client keeps working.
 */
export async function gatewayUrls(api) {
  const { openai, anthropic } = await api.get('/connect');
  return { openai: openai.baseUrl, anthropic: anthropic.baseUrl };
}

/** Find a developer by email, or create them. */
export async function findDeveloper(api, email) {
  const found = (await api.get('/developers')).find((developer) => developer.email === email);
  if (!found) {
    console.error(`No developer ${email}. Run \`npm run seed\` from the repo root first.`);
    process.exit(1);
  }
  return found;
}

/**
 * The plaintext, plus the ids the cleanup example needs to revoke it. Mode 0600 and gitignored:
 * this is the only place in the repo a usable key ever lands, and only because a shell script
 * has to read it back. Nothing here is ever committed.
 */
export function saveKey({ id, key, developerId }) {
  writeFileSync(KEY_FILE, `${id} ${developerId} ${key}\n`, { mode: 0o600 });
}

function readKeyFile() {
  try {
    const [id, developerId, key] = readFileSync(KEY_FILE, 'utf8').trim().split(' ');
    return { id, developerId, key };
  } catch {
    console.error('No key on disk. Run `node 1-issue-key.mjs` first.');
    process.exit(1);
  }
}

export const loadKey = () => readKeyFile().key;
export const loadKeyRef = () => readKeyFile();

/** Keys are secrets: show enough to recognise one, never enough to use it. */
export const mask = (key) => `${key.slice(0, 6)}…${key.slice(-4)}`;

export const heading = (text) => console.log(`\n\x1b[1m${text}\x1b[0m`);
