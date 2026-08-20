import { NotFoundError } from '../../core/errors.js';
import type { KeySpec, LlmGateway } from '../../core/gateway.js';
import type { UnitOfWork } from '../../core/unit-of-work.js';
import type { OrganizationService } from '../organizations/organization.service.js';

/**
 * Turns "what is this developer allowed to do" into the specification a gateway key is minted
 * from. Every key in the system is built here, so permissions and budgets cannot drift between
 * the issue path, the rotate path, and the re-sync path.
 */
export class AccessService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly gateway: LlmGateway,
    private readonly organizations: OrganizationService,
  ) {}

  async buildKeySpec(organizationId: string, userId: string, alias: string): Promise<KeySpec> {
    const [grants, budget, gatewayUserId] = await Promise.all([
      this.uow.repos.modelAccess.listEffectiveForUser(organizationId, userId),
      this.uow.repos.budgets.findForUser(organizationId, userId),
      this.organizations.ensureGatewayUser(organizationId, userId),
    ]);

    return {
      alias,
      gatewayUserId,
      models: grants.map((grant) => grant.gatewayModelName),
      aliases: Object.fromEntries(grants.map((grant) => [grant.publicModelName, grant.gatewayModelName])),
      maxBudget: budget?.maxBudget,
      budgetDuration: budget ? (budget.period === 'DAILY' ? '1d' : '30d') : undefined,
      rpmLimit: budget?.rpmLimit ?? undefined,
      tpmLimit: budget?.tpmLimit ?? undefined,
    };
  }

  /**
   * Pushes current permissions onto every live key. Called after any change to model access,
   * team membership, or budget — otherwise an existing key would keep its old grants.
   */
  async syncActiveKeys(organizationId: string, userId: string): Promise<void> {
    const keys = await this.uow.repos.keys.listActiveForUser(organizationId, userId);
    if (keys.length === 0) return;

    for (const key of keys) {
      const spec = await this.buildKeySpec(organizationId, userId, key.keyAlias);
      await this.gateway.updateKey(key.litellmKeyId, spec);
    }
  }

  async requireMembership(organizationId: string, userId: string) {
    const membership = await this.uow.repos.memberships.findWithUser(organizationId, userId);
    if (!membership) throw new NotFoundError('Developer');
    return membership;
  }
}
