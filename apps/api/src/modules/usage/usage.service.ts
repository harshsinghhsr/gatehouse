import type {
  BudgetRow,
  ConnectInfo,
  DateRange,
  DeveloperUsageRow,
  UsageBreakdownRow,
  UsageTotals,
} from '@gatehouse/shared';
import type { Config } from '../../core/config.js';
import type { LlmGateway, UsageReport } from '../../core/gateway.js';
import type { CacheStore } from '../../core/ports.js';
import type { UnitOfWork } from '../../core/unit-of-work.js';
import type { OrganizationService } from '../organizations/organization.service.js';

/**
 * Reporting. Every figure comes from the gateway, which priced each request when it served it;
 * the control plane never recomputes a token cost.
 */
const CACHE_TTL_SECONDS = 60;

export class UsageService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly gateway: LlmGateway,
    private readonly organizations: OrganizationService,
    private readonly cache: CacheStore,
    private readonly config: Pick<Config, 'gatewayPublicUrl'>,
  ) {}

  async totals(organizationId: string, range: DateRange): Promise<UsageTotals> {
    const { from, to } = resolveRange(range);
    return this.cached(`usage:totals:${organizationId}:${from}:${to}`, async () => {
      const report = await this.organizationReport(organizationId, from, to);
      const [activeDevelopers, activeModels] = await Promise.all([
        this.uow.repos.memberships.countByOrganization(organizationId),
        this.uow.repos.models.countEnabled(organizationId),
      ]);

      return {
        range: { from, to },
        spend: report.totalSpend,
        requests: report.totalRequests,
        inputTokens: report.inputTokens,
        outputTokens: report.outputTokens,
        activeDevelopers,
        activeModels,
        daily: report.daily,
      };
    });
  }

  /** Gateway model names are namespaced; the dashboard shows the name developers actually use. */
  async byModel(organizationId: string, range: DateRange): Promise<UsageBreakdownRow[]> {
    const { from, to } = resolveRange(range);
    return this.cached(`usage:models:${organizationId}:${from}:${to}`, async () => {
      const [report, catalog] = await Promise.all([
        this.organizationReport(organizationId, from, to),
        this.uow.repos.models.listByOrganization(organizationId),
      ]);
      const publicNames = new Map(catalog.map((model) => [model.gatewayModelName, model.publicModelName]));

      return toRows(report.byModel).map((row) => ({ ...row, name: publicNames.get(row.name) ?? row.name }));
    });
  }

  async byProvider(organizationId: string, range: DateRange): Promise<UsageBreakdownRow[]> {
    const { from, to } = resolveRange(range);
    return this.cached(`usage:providers:${organizationId}:${from}:${to}`, async () =>
      toRows((await this.organizationReport(organizationId, from, to)).byProvider),
    );
  }

  async byDeveloper(organizationId: string, range: DateRange): Promise<DeveloperUsageRow[]> {
    const { from, to } = resolveRange(range);
    return this.cached(`usage:developers:${organizationId}:${from}:${to}`, async () => {
      const memberships = await this.uow.repos.memberships.listMirrored(organizationId);

      // ponytail: one gateway call per developer, cached for a minute. Fine into the hundreds;
      // beyond that switch to the gateway's grouped spend report.
      const rows = await Promise.all(
        memberships.map(async (membership) => {
          const report = await this.gateway
            .userUsage(membership.litellmUserId as string, from, to)
            .catch(() => null);
          return {
            id: membership.user.id,
            name: membership.user.name,
            email: membership.user.email,
            spend: report?.totalSpend ?? 0,
            requests: report?.totalRequests ?? 0,
          };
        }),
      );
      return rows.sort((a, b) => b.spend - a.spend);
    });
  }

  async budgets(organizationId: string): Promise<BudgetRow[]> {
    const budgets = await this.uow.repos.budgets.listByOrganization(organizationId);
    return budgets.flatMap((budget) => {
      const holder = budget.user
        ? { kind: 'developer' as const, id: budget.user.id, name: budget.user.name, email: budget.user.email }
        : budget.team
          ? { kind: 'team' as const, id: budget.team.id, name: budget.team.name, email: null }
          : null;
      if (!holder) return [];

      return [
        {
          id: budget.id,
          maxBudget: budget.maxBudget,
          period: budget.period,
          rpmLimit: budget.rpmLimit,
          holder,
        },
      ];
    });
  }

  /** Everything a developer needs to point an SDK at the gateway. */
  async connectInfo(organizationId: string, userId: string): Promise<ConnectInfo> {
    const baseUrl = this.config.gatewayPublicUrl.replace(/\/$/, '');
    const [grants, keys] = await Promise.all([
      this.uow.repos.modelAccess.listEffectiveForUser(organizationId, userId),
      this.uow.repos.keys.listActiveForUser(organizationId, userId),
    ]);

    return {
      openai: { baseUrl: `${baseUrl}/v1` },
      // The Anthropic SDK appends /v1 itself.
      anthropic: { baseUrl },
      models: grants.map((grant) => grant.publicModelName).sort(),
      keys: keys.map((key) => ({
        id: key.id,
        keyPrefix: key.keyPrefix,
        createdAt: key.createdAt.toISOString(),
      })),
    };
  }

  private organizationReport(organizationId: string, from: string, to: string): Promise<UsageReport> {
    return this.organizations
      .ensureGatewayOrganization(organizationId)
      .then((gatewayOrgId) => this.gateway.organizationUsage(gatewayOrgId, from, to));
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = await this.cache.get(key);
    if (hit) {
      try {
        return JSON.parse(hit) as T;
      } catch {
        // Corrupt entry: fall through and recompute.
      }
    }
    const value = await load();
    await this.cache.set(key, JSON.stringify(value), CACHE_TTL_SECONDS);
    return value;
  }
}

/** Defaults to the trailing 30 days, the window the dashboard opens on. */
export function resolveRange(range: DateRange): { from: string; to: string } {
  const to = range.to ?? isoDate(new Date());
  const from = range.from ?? isoDate(new Date(Date.now() - 29 * 86_400_000));
  return { from, to };
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

const toRows = (buckets: Record<string, { spend: number; requests: number }>): UsageBreakdownRow[] =>
  Object.entries(buckets)
    .map(([name, bucket]) => ({ name, ...bucket }))
    .sort((a, b) => b.spend - a.spend);
