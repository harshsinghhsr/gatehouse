import { NotFoundError } from '../../core/errors.js';
import type { KeySpec, LlmGateway } from '../../core/gateway.js';
import type { UnitOfWork } from '../../core/unit-of-work.js';
import type { UserService } from '../users/user.service.js';

/**
 * Turns "what is this developer allowed to do" into the specification a gateway key is minted
 * from. Every key in the system is built here, so permissions and budgets cannot drift between
 * the issue path, the rotate path, and the re-sync path.
 */
export class AccessService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly gateway: LlmGateway,
    private readonly users: UserService,
  ) {}

  async buildKeySpec(userId: string, alias: string): Promise<KeySpec> {
    const [grants, budget, gatewayUserId] = await Promise.all([
      this.uow.repos.modelAccess.listEffectiveForUser(userId),
      this.uow.repos.budgets.findForUser(userId),
      this.users.ensureGatewayUser(userId),
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
  async syncActiveKeys(userId: string): Promise<void> {
    const keys = await this.uow.repos.keys.listActiveForUser(userId);
    if (keys.length === 0) return;

    for (const key of keys) {
      const spec = await this.buildKeySpec(userId, key.keyAlias);
      await this.gateway.updateKey(key.litellmKeyId, spec);
    }
  }

  async requireUser(userId: string) {
    const user = await this.uow.repos.users.findById(userId);
    if (!user) throw new NotFoundError('Developer');
    return user;
  }
}
