/**
 * Development seed. Drives the public HTTP API exactly as an operator would, so everything it
 * creates passes the same zod validation, LiteLLM synchronisation and audit logging as a real
 * click. It never touches the database directly.
 *
 *     npm run seed
 *
 * Safe to re-run: anything that already exists by name or email is reused, not duplicated.
 */

const BASE_URL = process.env.SEED_BASE_URL ?? 'http://localhost:3001/api';
const PASSWORD = process.env.SEED_PASSWORD ?? 'GatehouseDev!2026';
const WEB_URL = process.env.SEED_WEB_URL ?? 'http://localhost:3000';

// This mints accounts with a printed password, so it must be impossible to aim at production.
{
  const host = new URL(BASE_URL).hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (!local || process.env.NODE_ENV === 'production') {
    console.error(`Refusing to seed ${BASE_URL} (NODE_ENV=${process.env.NODE_ENV ?? 'unset'}).`);
    console.error('The seed only runs against a local development instance.');
    process.exit(1);
  }
}

type Json = Record<string, unknown>;

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/** One signed-in browser: the session cookie is httpOnly, so we carry it by hand. */
class Client {
  private cookie: string | null = null;

  async call<T>(method: string, path: string, body?: Json): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith('gw_session='));
    if (setCookie) this.cookie = setCookie.split(';')[0] ?? null;

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as Json) : {};
    if (!response.ok) {
      const error = (payload.error ?? {}) as { code?: string; message?: string };
      throw new ApiError(response.status, error.code ?? 'error', `${method} ${path}: ${error.message ?? text}`);
    }
    return payload as T;
  }

  get = <T>(path: string) => this.call<T>('GET', path);
  post = <T>(path: string, body?: Json) => this.call<T>('POST', path, body);
  put = <T>(path: string, body: Json) => this.call<T>('PUT', path, body);
  patch = <T>(path: string, body: Json) => this.call<T>('PATCH', path, body);
}

/** Create only what is missing, keyed on whatever the list endpoint already exposes. */
async function ensure<T>(
  api: Client,
  listPath: string,
  match: (row: T) => boolean,
  createPath: string,
  body: Json,
): Promise<T> {
  const existing = (await api.get<T[]>(listPath)).find(match);
  if (existing) return existing;
  return api.post<T>(createPath, body);
}

type Provider = { id: string; name: string; type: string; status: string };
type Model = { id: string; publicModelName: string; provider: { id: string } };
type Developer = { id: string; email: string; name: string; role: string; status: string; activeKeys: number };
type Team = { id: string; name: string; viewerRole: string | null };
type Key = { id: string; status: string };
type DeveloperUsage = { id: string; spend: number };

const notes: string[] = [];
const accounts: Array<[string, string, string]> = [];

async function main(): Promise<void> {
  // 1. The owner. Registration only works while the instance has no users at all.
  const owner = new Client();
  try {
    await owner.post('/auth/register', {
      email: 'owner@gatehouse.dev',
      name: 'Olivia Owner',
      password: PASSWORD,
    });
    console.log('Registered the first account as OWNER.');
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    await owner.post('/auth/login', { email: 'owner@gatehouse.dev', password: PASSWORD });
    console.log('Instance already has users; signed in as the existing owner.');
  }

  // 2. Providers. Creation verifies the credential against the real provider before writing
  //    anything, so a placeholder key cannot produce a provider row. Supply real keys through
  //    the environment to get the real catalogue; without them each provider falls back to the
  //    development MOCK type, which the API only offers when ENABLE_MOCK_PROVIDER is set. Its
  //    models answer from inside LiteLLM — no vendor, no key — but the tokens are counted and
  //    priced for real, which is what gives the dashboard something to show.
  const mockAvailable = (await owner.get<Array<{ type: string }>>('/provider-types')).some(
    (type) => type.type === 'MOCK',
  );
  if (!mockAvailable) {
    notes.push('ENABLE_MOCK_PROVIDER is not set, so there is no traffic to report. See README.');
  }

  const ensureProvider = async (
    name: string,
    type: string,
    apiKey: string | undefined,
    config: Record<string, string> = {},
    envVar: string,
  ): Promise<Provider | null> => {
    const existing = (await owner.get<Provider[]>('/providers')).find((p) => p.name === name);
    if (existing) return existing;
    if (!apiKey && !mockAvailable) {
      notes.push(`Skipped provider "${name}": set ${envVar} to a working key to seed it.`);
      return null;
    }
    const body = apiKey
      ? { name, type, credentials: { apiKey }, config }
      : { name, type: 'MOCK', credentials: {} };
    if (!apiKey) notes.push(`"${name}" is a mock provider: set ${envVar} to seed the real one.`);
    try {
      return await owner.post<Provider>('/providers', body);
    } catch (error) {
      notes.push(`Provider "${name}" was refused: ${(error as Error).message}`);
      return null;
    }
  };

  const openai = await ensureProvider('OpenAI Production', 'OPENAI', process.env.SEED_OPENAI_API_KEY, {}, 'SEED_OPENAI_API_KEY');
  const anthropic = await ensureProvider('Anthropic Production', 'ANTHROPIC', process.env.SEED_ANTHROPIC_API_KEY, {}, 'SEED_ANTHROPIC_API_KEY');
  const azure = await ensureProvider(
    'Azure OpenAI EU',
    'AZURE_OPENAI',
    process.env.SEED_AZURE_API_KEY,
    {
      apiBase: process.env.SEED_AZURE_API_BASE ?? 'https://gatehouse-dev.openai.azure.com',
      apiVersion: process.env.SEED_AZURE_API_VERSION ?? '2024-10-21',
    },
    'SEED_AZURE_API_KEY',
  );
  // Deliberately left with no models at all, for the empty state.
  await ensureProvider('OpenAI Sandbox', 'OPENAI', process.env.SEED_OPENAI_API_KEY, {}, 'SEED_OPENAI_API_KEY');

  // A disabled provider, and a provider whose last test failed, so both states render.
  if (azure) await owner.patch(`/providers/${azure.id}`, { status: 'DISABLED' });
  if (azure) {
    await owner.post(`/providers/${azure.id}/test`).catch((error: unknown) => {
      notes.push(`"Azure OpenAI EU" test failed, which is what puts a lastTestError on the row: ${(error as Error).message}`);
    });
  }

  // 3. Models. "chat-default" is published by two providers on purpose: the gateway name is
  //    namespaced per provider, so the composite unique holds and the namespacing is visible.
  const catalogue = new Map<string, string>();
  /** Public names served by a mock provider, and so safe (and free) to send traffic to. */
  const mocked = new Set<string>();
  /**
   * `whenMocked` is the model LiteLLM is asked for behind a mock provider. LiteLLM prices the
   * mocked token counts from its own table, so it has to be a model that table knows, written
   * "provider/model": a deployment name meters at zero, and an unprefixed name LiteLLM cannot
   * attribute is refused outright.
   */
  const model = async (
    provider: Provider | null,
    publicModelName: string,
    providerModelName: string,
    whenMocked = providerModelName,
  ) => {
    if (!provider) return;
    const upstream = provider.type === 'MOCK' ? whenMocked : providerModelName;
    const found = await ensure<Model>(
      owner,
      '/models',
      (m) => m.publicModelName === publicModelName && m.provider.id === provider.id,
      '/models',
      { providerId: provider.id, publicModelName, providerModelName: upstream },
    );
    catalogue.set(`${provider.name}/${publicModelName}`, found.id);
    if (provider.type === 'MOCK') mocked.add(publicModelName);
  };

  await model(openai, 'gpt-4o', 'gpt-4o', 'openai/gpt-4o');
  await model(openai, 'o1-pro', 'o1-pro', 'openai/o1-pro');
  await model(openai, 'gpt-4o-mini', 'gpt-4o-mini', 'openai/gpt-4o-mini');
  await model(openai, 'chat-default', 'gpt-4o', 'openai/gpt-4o');
  await model(openai, 'gpt-3.5-turbo', 'gpt-3.5-turbo', 'openai/gpt-3.5-turbo');
  await model(anthropic, 'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929', 'anthropic/claude-3-5-sonnet-20241022');
  await model(anthropic, 'claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'anthropic/claude-3-5-haiku-20241022');
  await model(anthropic, 'chat-default', 'claude-sonnet-4-5-20250929', 'anthropic/claude-3-5-sonnet-20241022');
  await model(azure, 'gpt-4o-eu', 'gpt-4o-eu-deployment', 'openai/gpt-4o');

  const legacy = catalogue.get('OpenAI Production/gpt-3.5-turbo');
  if (legacy) await owner.patch(`/models/${legacy}`, { enabled: false });

  /** Grants are only written when the models behind them actually exist. */
  const grant = async (path: string, ...keys: string[]) => {
    const modelIds = keys.map((key) => catalogue.get(key)).filter((id): id is string => Boolean(id));
    if (modelIds.length > 0) await owner.put(path, { modelIds });
  };

  // 4. People. Everyone gets the same known dev password so each role can be signed into.
  const developer = async (email: string, name: string, role: 'ADMIN' | 'MEMBER', demonstrates: string) => {
    const person = await ensure<Developer>(owner, '/developers', (d) => d.email === email, '/developers', {
      email,
      name,
      password: PASSWORD,
      role,
    });
    accounts.push([email, name, demonstrates]);
    return person;
  };

  accounts.push(['owner@gatehouse.dev', 'Olivia Owner', 'OWNER: everything, including role changes']);
  await developer('admin@gatehouse.dev', 'Ada Admin', 'ADMIN', 'ADMIN: manages every team, cannot change roles');
  const member = await developer('member@gatehouse.dev', 'Milo Member', 'MEMBER', 'MEMBER leading no team: read-only team views');
  const lead = await developer('lead@gatehouse.dev', 'Leah Lead', 'MEMBER', 'LEAD of Platform, MEMBER of Research, not in Billing: per-team viewerRole gating');
  const direct = await developer('direct@gatehouse.dev', 'Dana Direct', 'MEMBER', 'Direct model grants only, three ACTIVE keys, healthy MONTHLY budget');
  const viaTeam = await developer('viateam@gatehouse.dev', 'Tara Team', 'MEMBER', 'Model access only through a team');
  const both = await developer('both@gatehouse.dev', 'Bianca Both', 'MEMBER', 'Direct + team grants overlapping, one ROTATED key, tight DAILY budget');
  await developer('nogrants@gatehouse.dev', 'Noel None', 'MEMBER', 'No grants, no keys, no budget: empty states');
  const revoked = await developer('revoked@gatehouse.dev', 'Rhea Revoked', 'MEMBER', 'A single REVOKED key and no active ones');
  const disabled = await developer('disabled@gatehouse.dev', 'Dana Disabled', 'MEMBER', 'DISABLED MEMBER: cannot sign in, keys auto-revoked');
  const disabledAdmin = await developer('admin.disabled@gatehouse.dev', 'Alan Archived', 'ADMIN', 'DISABLED ADMIN: cannot sign in');
  const secondOwner = await developer('owner2@gatehouse.dev', 'Otto Owner', 'ADMIN', 'Second OWNER, disabled: proves OWNER x DISABLED without tripping the last-owner guard');

  // 5. Teams.
  const platform = await ensure<Team>(owner, '/teams', (t) => t.name === 'Platform', '/teams', { name: 'Platform' });
  const research = await ensure<Team>(owner, '/teams', (t) => t.name === 'Research', '/teams', { name: 'Research' });
  const billing = await ensure<Team>(owner, '/teams', (t) => t.name === 'Billing', '/teams', { name: 'Billing' });

  /**
   * Only the people who are not in the team yet: the membership row upserts happily, but the
   * gateway rejects re-adding someone it already has on the team, so a blind re-POST would fail.
   */
  const addMembers = async (team: Team, roster: Array<[string, 'LEAD' | 'MEMBER']>) => {
    const detail = await owner.get<{ members: Array<{ id: string }> }>(`/teams/${team.id}`);
    const present = new Set(detail.members.map((m) => m.id));
    for (const [userId, role] of roster) {
      if (!present.has(userId)) await owner.post(`/teams/${team.id}/members`, { userId, role });
    }
  };

  await addMembers(platform, [
    [lead.id, 'LEAD'],
    [member.id, 'MEMBER'],
    [both.id, 'MEMBER'],
  ]);
  await addMembers(research, [
    [lead.id, 'MEMBER'],
    [viaTeam.id, 'MEMBER'],
  ]);
  // Billing stays empty, and the lead belongs to neither it nor its roster: viewerRole null.

  await grant(`/teams/${platform.id}/models`, 'OpenAI Production/gpt-4o', 'Anthropic Production/claude-haiku-4-5');
  await grant(`/teams/${research.id}/models`, 'OpenAI Production/gpt-4o-mini');
  // Billing gets no grants.

  // 6. Model access: direct, team-only, both, and nothing.
  await grant(
    `/developers/${direct.id}/models`,
    'OpenAI Production/gpt-4o',
    'OpenAI Production/o1-pro',
    'Anthropic Production/claude-sonnet-4-5',
  );
  await grant(
    `/developers/${both.id}/models`,
    'OpenAI Production/gpt-4o',
    'OpenAI Production/o1-pro',
    'OpenAI Production/chat-default',
  );
  await grant(`/developers/${disabled.id}/models`, 'OpenAI Production/gpt-4o-mini');
  await grant(`/developers/${revoked.id}/models`, 'Anthropic Production/claude-sonnet-4-5');
  // viaTeam gets Research's grants; `none` gets nothing at all.

  // 7. Budgets: both periods, with and without rate limits, roomy and tight.
  await owner.patch(`/developers/${direct.id}`, {
    budget: { maxBudget: 500, period: 'MONTHLY', rpmLimit: 60, tpmLimit: 200_000 },
  });
  await owner.patch(`/developers/${both.id}`, { budget: { maxBudget: 1, period: 'DAILY' } });
  await owner.patch(`/developers/${member.id}`, { budget: { maxBudget: 25, period: 'MONTHLY' } });

  // 8. Keys. REVOKED and ROTATED are reached through the real endpoints.
  const keyCount = async (userId: string) => (await owner.get<{ keys: Key[] }>(`/developers/${userId}`)).keys.length;

  const issue = async (userId: string, times = 1) => {
    for (let index = 0; index < times; index += 1) {
      // The plaintext comes back exactly once here and is deliberately dropped on the floor.
      await owner.post<{ id: string }>(`/developers/${userId}/keys`);
    }
  };

  if ((await keyCount(direct.id)) === 0) await issue(direct.id, 3);

  if ((await keyCount(revoked.id)) === 0) {
    const key = await owner.post<{ id: string }>(`/developers/${revoked.id}/keys`);
    await owner.post(`/developers/${revoked.id}/keys/${key.id}/revoke`);
  }

  if ((await keyCount(both.id)) === 0) {
    const key = await owner.post<{ id: string }>(`/developers/${both.id}/keys`);
    await owner.post(`/developers/${both.id}/keys/${key.id}/rotate`);
  }

  // Issued before disabling on purpose: disabling revokes them, leaving visible key history.
  if ((await keyCount(disabled.id)) === 0) await issue(disabled.id, 1);

  // 9. Traffic, so the dashboard has spend, tokens and a distribution to draw. A mock model is
  //    answered inside LiteLLM, so nothing is sent to a vendor and nothing is charged — but the
  //    tokens are counted and priced exactly as real ones are. Only mock models are called:
  //    driving a real provider's key here would spend the operator's money.
  const { openai: endpoint } = await owner.get<{ openai: { baseUrl: string } }>('/connect');

  // A mocked answer is metered at a fixed 10 prompt / 20 completion tokens whatever is sent, so
  // what a developer spends is decided by how many calls they make and how dear the model is.
  const call = async (key: string, model: string): Promise<number> => {
    const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Summarise these notes.' }] }),
    });
    if (!response.ok) {
      throw new Error(`${model} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    // LiteLLM priced this request; taking its number back off the header is the only way to know
    // what a call cost without recomputing a price here, which is not ours to do.
    return Number(response.headers.get('x-litellm-response-cost') ?? 0);
  };

  /**
   * A key's plaintext is returned exactly once, and the keys issued above are long gone, so the
   * traffic runs on a key of its own that is revoked as soon as it is finished. Re-running the
   * seed therefore never leaves a usable credential lying around.
   */
  const traffic = async (person: Developer, plan: Array<[model: string, calls: number]>): Promise<number> => {
    const usable = plan.filter(([model]) => mocked.has(model));
    if (usable.length === 0) return 0;

    let cost = 0;
    const key = await owner.post<{ id: string; key: string }>(`/developers/${person.id}/keys`);
    try {
      for (const [model, calls] of usable) {
        for (let index = 0; index < calls; index += 1) cost += await call(key.key, model);
      }
    } catch (error) {
      notes.push(`Traffic for ${person.email} stopped early: ${(error as Error).message}`);
    } finally {
      await owner.post(`/developers/${person.id}/keys/${key.id}/revoke`);
    }
    return cost;
  };

  // Bianca is the developer whose meter should read close to full, so her ceiling is set from
  // what she actually spends. Two things have to happen before the traffic runs: the ceiling the
  // last run left behind is enforced by the gateway and would refuse this run's calls, and her
  // spend so far has to be read while it still excludes them — the gateway aggregates its daily
  // figures behind the request, so reading straight afterwards would miss what was just sent.
  await owner.patch(`/developers/${both.id}`, { budget: { maxBudget: 1000, period: 'DAILY' } });
  const today = new Date().toISOString().slice(0, 10);
  const spentBefore =
    (await owner.get<DeveloperUsage[]>(`/usage/developers?from=${today}&to=${today}`)).find(
      (row) => row.id === both.id,
    )?.spend ?? 0;

  await traffic(direct, [
    ['o1-pro', 12],
    ['gpt-4o', 8],
    ['claude-sonnet-4-5', 4],
  ]);
  const biancaSpent = await traffic(both, [
    ['o1-pro', 5],
    ['chat-default', 6],
  ]);
  await traffic(member, [
    ['gpt-4o', 6],
    ['claude-haiku-4-5', 3],
  ]);
  await traffic(viaTeam, [['gpt-4o-mini', 8]]);

  // A DAILY budget covers the whole day, so it is what she had already spent plus what this run
  // cost her. Sitting at 85% of the ceiling is what makes the meter worth looking at.
  const spentToday = spentBefore + biancaSpent;
  if (spentToday > 0) {
    await owner.patch(`/developers/${both.id}`, {
      budget: { maxBudget: Number((spentToday / 0.85).toFixed(4)), period: 'DAILY' },
    });
  }

  // 10. Statuses last, because disabling revokes keys and blocks further issuance.
  await owner.patch(`/developers/${secondOwner.id}`, { role: 'OWNER' });
  for (const person of [disabled, disabledAdmin, secondOwner]) {
    await owner.patch(`/developers/${person.id}`, { status: 'DISABLED' });
  }

  await report(owner);
}

async function report(owner: Client): Promise<void> {
  const [developers, teams, usage] = await Promise.all([
    owner.get<Developer[]>('/developers'),
    owner.get<Team[]>('/teams'),
    owner.get<{
      spend: number;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      activeModels: number;
    }>('/usage'),
  ]);
  const models = await owner.get<Model[]>('/models');
  const providers = await owner.get<Provider[]>('/providers');

  console.log(`\nProviders ${providers.length} · models ${models.length} · developers ${developers.length} · teams ${teams.length}`);
  console.log(
    `Usage: spend ${usage.spend}, requests ${usage.requests}, ` +
      `tokens ${usage.inputTokens + usage.outputTokens}, active models ${usage.activeModels}`,
  );
  console.log(`\nEvery account below uses the password: ${PASSWORD}\n`);

  const width = Math.max(...accounts.map(([email]) => email.length));
  for (const [email, name, demonstrates] of accounts) {
    console.log(`  ${email.padEnd(width)}  ${name.padEnd(16)}  ${demonstrates}`);
  }

  if (notes.length > 0) {
    console.log('\nNotes:');
    for (const note of notes) console.log(`  - ${note}`);
  }
  console.log(`\nOpen ${WEB_URL} and sign in as owner@gatehouse.dev.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
