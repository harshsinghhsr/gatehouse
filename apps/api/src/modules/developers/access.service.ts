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
    const [grants, gatewayUserId] = await Promise.all([
      this.uow.repos.modelAccess.listEffectiveForUser(userId),
      this.users.ensureGatewayUser(userId),
    ]);

    // Building a key is also the moment the developer's ceiling is guaranteed current, so no
    // caller can mint or re-sync a key while the gateway still holds a stale budget.
    await this.syncBudget(userId, gatewayUserId);

    return {
      alias,
      gatewayUserId,
      models: grants.map((grant) => grant.gatewayModelName),
      aliases: Object.fromEntries(grants.map((grant) => [grant.publicModelName, grant.gatewayModelName])),
    };
  }

  /**
   * The ceiling belongs to the developer, so it is pushed to their mirrored gateway user and every
   * key they hold spends against the same allowance. Setting it per key multiplied the limit by
   * the number of keys issued. rpm/tpm ride along on the user for the same reason: the dashboard
   * presents one number per developer, and splitting enforcement across keys would make that
   * number mean something different depending on how many keys happened to exist.
   */
  async syncBudget(userId: string, knownGatewayUserId?: string): Promise<void> {
    const [budget, gatewayUserId] = await Promise.all([
      this.uow.repos.budgets.findForUser(userId),
      knownGatewayUserId ? Promise.resolve(knownGatewayUserId) : this.users.ensureGatewayUser(userId),
    ]);

    await this.gateway.setUserBudget(gatewayUserId, {
      maxBudget: budget?.maxBudget,
      budgetDuration: budget ? (budget.period === 'DAILY' ? '1d' : '30d') : undefined,
      rpmLimit: budget?.rpmLimit ?? undefined,
      tpmLimit: budget?.tpmLimit ?? undefined,
    });
  }

  /**
   * Pushes current permissions onto every live key. Called after any change to model access,
   * team membership, or budget — otherwise an existing key would keep its old grants.
   */
  async syncActiveKeys(userId: string): Promise<void> {
    const keys = await this.uow.repos.keys.listActiveForUser(userId);
    // The ceiling lives on the user, so it has to be pushed even when no key exists yet.
    await this.syncBudget(userId);
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
