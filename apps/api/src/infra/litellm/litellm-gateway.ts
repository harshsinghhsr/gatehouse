import { NotFoundError, UnavailableError, UpstreamError } from '../../core/errors.js';
import type {
  IssuedGatewayKey,
  KeySpec,
  KeyUsage,
  LlmGateway,
  UsageBucket,
  UsageReport,
  UserBudgetSpec,
} from '../../core/gateway.js';
import type { Logger } from '../../core/ports.js';
import type * as wire from './litellm.types.js';

/**
 * LiteLLM adapter. The only file in the codebase that knows LiteLLM's HTTP surface.
 * Contract: litellm/openapi.v1.97.0.json, dumped from the pinned image.
 */

type Options = {
  baseUrl: string;
  masterKey: string;
  logger: Logger;
  timeoutMs?: number;
  attempts?: number;
};

export class LiteLlmGateway implements LlmGateway {
  private readonly baseUrl: string;
  private readonly masterKey: string;
  private readonly logger: Logger;
  private readonly timeoutMs: number;
  private readonly attempts: number;

  constructor({ baseUrl, masterKey, logger, timeoutMs = 10_000, attempts = 3 }: Options) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.masterKey = masterKey;
    this.logger = logger;
    this.timeoutMs = timeoutMs;
    this.attempts = attempts;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastNetworkError: unknown;

    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.masterKey}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        // Network-level failure: worth retrying with backoff.
        lastNetworkError = error;
        if (attempt < this.attempts) await delay(100 * 2 ** attempt + Math.random() * 100);
        continue;
      }

      if (response.status >= 500) {
        lastNetworkError = new Error(`gateway responded ${response.status}`);
        if (attempt < this.attempts) await delay(100 * 2 ** attempt + Math.random() * 100);
        continue;
      }

      if (!response.ok) {
        // A 4xx is deterministic, so never retried. The body can quote back what we sent it,
        // credentials included, so it is logged and never returned to the caller.
        this.logger.error(
          { method, path, status: response.status, body: await response.text() },
          'gateway rejected call',
        );
        if (response.status === 404) throw new NotFoundError('Gateway resource');
        throw new UpstreamError(`The gateway rejected this request (${response.status})`, 'gateway_rejected');
      }

      return (await response.json()) as T;
    }

    throw new UnavailableError(`Gateway is unreachable: ${String(lastNetworkError)}`);
  }

  // --- keys -----------------------------------------------------------------

  async issueKey(spec: KeySpec): Promise<IssuedGatewayKey> {
    const response = await this.call<wire.GenerateKeyResponse>('POST', '/key/generate', toKeyPayload(spec));
    return {
      secret: response.key,
      keyId: response.token_id ?? response.token ?? '',
      expiresAt: response.expires ? new Date(response.expires) : null,
    };
  }

  async updateKey(keyId: string, spec: KeySpec): Promise<void> {
    await this.call('POST', '/key/update', { key: keyId, ...toKeyPayload(spec) });
  }

  /** By alias, because the plaintext key is never stored on our side. */
  async revokeKeyByAlias(alias: string): Promise<void> {
    await this.call('POST', '/key/delete', { key_aliases: [alias] });
  }

  async readKeyUsage(keyId: string): Promise<KeyUsage | null> {
    const response = await this.call<wire.KeyInfoResponse>(
      'GET',
      `/key/info?key=${encodeURIComponent(keyId)}`,
    );
    if (!response.info) return null;
    return { spend: response.info.spend ?? 0, maxBudget: response.info.max_budget ?? null };
  }

  // --- identity mirror ------------------------------------------------------

  async createUser(email: string): Promise<string> {
    const response = await this.call<wire.NewUserResponse>('POST', '/user/new', {
      user_email: email,
      user_role: 'internal_user',
      auto_create_key: false,
    });
    return response.user_id;
  }

  /**
   * One allowance per developer, shared by every key they hold. Nulls clear a previous ceiling
   * rather than leaving it in force when a budget is removed.
   */
  async setUserBudget(gatewayUserId: string, budget: UserBudgetSpec): Promise<void> {
    await this.call('POST', '/user/update', {
      user_id: gatewayUserId,
      max_budget: budget.maxBudget ?? null,
      budget_duration: budget.budgetDuration ?? null,
      rpm_limit: budget.rpmLimit ?? null,
      tpm_limit: budget.tpmLimit ?? null,
    });
  }

  async createTeam(name: string): Promise<string> {
    const response = await this.call<wire.NewTeamResponse>('POST', '/team/new', {
      team_alias: name,
    });
    return response.team_id;
  }

  async addTeamMember(teamId: string, userId: string): Promise<void> {
    await this.call('POST', '/team/member_add', {
      team_id: teamId,
      member: [{ user_id: userId, role: 'user' }],
    });
  }

  // --- credentials and models ----------------------------------------------

  async putCredential(
    name: string,
    values: Record<string, string>,
    info: Record<string, unknown> = {},
  ): Promise<void> {
    // No upsert endpoint exists, so replace: delete is best-effort for a first write.
    await this.deleteCredential(name).catch(() => undefined);
    await this.call('POST', '/credentials', {
      credential_name: name,
      credential_values: values,
      credential_info: info,
    });
  }

  async deleteCredential(name: string): Promise<void> {
    await this.call('DELETE', `/credentials/${encodeURIComponent(name)}`);
  }

  async registerModel(
    name: string,
    params: Record<string, unknown>,
    info: Record<string, unknown> = {},
  ): Promise<string> {
    const response = await this.call<wire.NewModelResponse>('POST', '/model/new', {
      model_name: name,
      litellm_params: params,
      model_info: info,
    });
    return response.model_info?.id ?? '';
  }

  async deregisterModel(modelId: string): Promise<void> {
    await this.call('POST', '/model/delete', { id: modelId });
  }

  // --- usage ----------------------------------------------------------------

  async instanceUsage(from: string, to: string): Promise<UsageReport> {
    // No user_id: under the master key this returns every user's activity, which in a
    // single-tenant deployment is the whole instance. /gateway/daily/activity looks like the
    // better fit by name but reports request counts by route, with no spend dimension.
    const query = new URLSearchParams({ start_date: from, end_date: to, page_size: '100' });
    return toUsageReport(await this.call<wire.DailyActivityResponse>('GET', `/user/daily/activity?${query}`));
  }

  async userUsage(userId: string, from: string, to: string): Promise<UsageReport> {
    const query = new URLSearchParams({ start_date: from, end_date: to, user_id: userId, page_size: '100' });
    return toUsageReport(await this.call<wire.DailyActivityResponse>('GET', `/user/daily/activity?${query}`));
  }

  /** Liveliness, never /health — that one fans out to every configured provider. */
  async health(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/health/liveliness`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new UnavailableError(`Gateway health check returned ${response.status}`);
  }
}

/**
 * LiteLLM checks the requested model against `models` BEFORE resolving `aliases`, so a key
 * limited to "azure/gpt-5" would reject a developer asking for "gpt-5". Both names are therefore
 * allowed and the alias performs the routing. Safe only because every model this control plane
 * registers is namespaced by provider slug.
 */
function toKeyPayload(spec: KeySpec): Record<string, unknown> {
  const publicNames = Object.keys(spec.aliases);
  return {
    key_alias: spec.alias,
    user_id: spec.gatewayUserId,
    team_id: spec.gatewayTeamId,
    models: [...new Set([...spec.models, ...publicNames])],
    aliases: spec.aliases,
    // Budgets live on the gateway user, not here. Sent as explicit nulls rather than omitted so
    // a key issued before that change gets its old per-key ceiling cleared on the next sync,
    // instead of quietly enforcing a second allowance underneath the user-level one.
    max_budget: null,
    budget_duration: null,
    rpm_limit: null,
    tpm_limit: null,
  };
}

function toUsageReport(response: wire.DailyActivityResponse): UsageReport {
  const days = response.results ?? [];
  const accumulate = (dimension: 'models' | 'providers'): Record<string, UsageBucket> => {
    const totals: Record<string, UsageBucket> = {};
    for (const day of days) {
      for (const [name, entry] of Object.entries(day.breakdown?.[dimension] ?? {})) {
        const bucket = (totals[name] ??= { spend: 0, requests: 0, failedRequests: 0 });
        bucket.spend += entry.metrics?.spend ?? 0;
        bucket.requests += entry.metrics?.successful_requests ?? 0;
        bucket.failedRequests += entry.metrics?.failed_requests ?? 0;
      }
    }
    return totals;
  };

  // metadata.total_api_requests counts refusals too, so a key denied a model would read as
  // traffic. Sum the per-day successful and failed counters instead and report them apart.
  const sum = (pick: (day: (typeof days)[number]) => number) => days.reduce((total, day) => total + pick(day), 0);

  return {
    totalSpend: response.metadata?.total_spend ?? 0,
    totalRequests: sum((day) => day.metrics?.successful_requests ?? 0),
    totalFailedRequests: sum((day) => day.metrics?.failed_requests ?? 0),
    inputTokens: days.reduce((sum, day) => sum + (day.metrics?.prompt_tokens ?? 0), 0),
    outputTokens: days.reduce((sum, day) => sum + (day.metrics?.completion_tokens ?? 0), 0),
    daily: days.map((day) => ({
      date: day.date,
      spend: day.metrics?.spend ?? 0,
      requests: day.metrics?.successful_requests ?? 0,
    })),
    byModel: accumulate('models'),
    byProvider: accumulate('providers'),
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
