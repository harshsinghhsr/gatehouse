import type {
  CreateDeveloperRequest,
  DeveloperDetail,
  DeveloperSummary,
  SetModelAccessRequest,
  UpdateDeveloperRequest,
} from '@gatehouse/shared';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../core/errors.js';
import type { LlmGateway } from '../../core/gateway.js';
import type { UnitOfWork } from '../../core/unit-of-work.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/authenticator.js';
import type { PasswordHasher } from '../auth/password.js';
import type { AccessService } from './access.service.js';
import type { KeyService } from './key.service.js';

export class DeveloperService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly gateway: LlmGateway,
    private readonly access: AccessService,
    private readonly keys: KeyService,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<DeveloperSummary[]> {
    const [users, activeKeys] = await Promise.all([
      this.uow.repos.users.list(),
      this.uow.repos.keys.countActiveByUser(),
    ]);

    return users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      role: user.role,
      activeKeys: activeKeys.get(user.id) ?? 0,
    }));
  }

  async get(userId: string): Promise<DeveloperDetail> {
    const user = await this.access.requireUser(userId);

    const [grants, budget, keys, teams, activeKeys] = await Promise.all([
      this.uow.repos.modelAccess.listEffectiveForUser(userId),
      this.uow.repos.budgets.findForUser(userId),
      this.uow.repos.keys.listForUser(userId),
      this.uow.repos.teams.listForUser(userId),
      this.uow.repos.keys.listActiveForUser(userId),
    ]);

    // Spend is the gateway's figure. A failure to read it must not fail the page.
    const activeKey = activeKeys[0];
    const usage = activeKey
      ? await this.gateway.readKeyUsage(activeKey.litellmKeyId).catch(() => null)
      : null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      role: user.role,
      activeKeys: activeKeys.length,
      models: grants.map((grant) => ({ id: grant.providerModelId, publicModelName: grant.publicModelName })),
      budget: budget
        ? {
            maxBudget: budget.maxBudget,
            period: budget.period,
            rpmLimit: budget.rpmLimit,
            tpmLimit: budget.tpmLimit,
          }
        : null,
      spend: usage?.spend ?? null,
      teams: teams.map((team) => ({ id: team.id, name: team.name })),
      keys: keys.map((key) => ({
        id: key.id,
        keyAlias: key.keyAlias,
        keyPrefix: key.keyPrefix,
        status: key.status,
        createdAt: key.createdAt.toISOString(),
        revokedAt: key.revokedAt?.toISOString() ?? null,
      })),
    };
  }

  async create(context: AuthContext, request: CreateDeveloperRequest): Promise<DeveloperSummary> {
    const passwordHash = request.password ? await this.hasher.hash(request.password) : null;

    if (await this.uow.repos.users.emailExists(request.email)) {
      throw new ConflictError('A developer with this email already exists');
    }

    return this.uow.transaction(async (repos) => {
      const user = await repos.users.create({
        email: request.email,
        name: request.name,
        passwordHash,
        role: request.role,
      });

      await this.audit.record(
        context,
        {
          action: 'USER_CREATED',
          targetType: 'user',
          targetId: user.id,
          metadata: { email: user.email, role: request.role },
        },
        repos,
      );

      return { ...user, activeKeys: 0 };
    });
  }

  async update(context: AuthContext, userId: string, request: UpdateDeveloperRequest): Promise<void> {
    await this.access.requireUser(userId);
    if (request.role && context.role !== 'OWNER') {
      throw new ForbiddenError('Only an owner can change roles');
    }

    if (request.status) {
      await this.uow.repos.users.setStatus(userId, request.status);
      // A disabled developer loses gateway access now, not at the next rotation.
      if (request.status === 'DISABLED') await this.keys.revokeAllForUser(userId);
      await this.audit.record(context, {
        action: request.status === 'DISABLED' ? 'USER_DISABLED' : 'USER_UPDATED',
        targetType: 'user',
        targetId: userId,
        metadata: { status: request.status },
      });
    }

    if (request.role) {
      await this.uow.repos.users.setRole(userId, request.role);
      await this.audit.record(context, {
        action: 'USER_UPDATED',
        targetType: 'user',
        targetId: userId,
        metadata: { role: request.role },
      });
    }

    if (request.budget) {
      await this.uow.repos.budgets.upsertForUser(userId, {
        maxBudget: request.budget.maxBudget,
        period: request.budget.period,
        rpmLimit: request.budget.rpmLimit ?? null,
        tpmLimit: request.budget.tpmLimit ?? null,
      });
      // The gateway enforces budgets, so live keys have to learn the new ceiling.
      await this.access.syncActiveKeys(userId);
      await this.audit.record(context, {
        action: 'BUDGET_UPDATED',
        targetType: 'user',
        targetId: userId,
        metadata: { maxBudget: request.budget.maxBudget, period: request.budget.period },
      });
    }
  }

  /**
   * Deletes the account outright. The cascade takes its keys, budgets, model access, and team
   * memberships with it, so the gateway-side keys are revoked first rather than orphaned.
   */
  async remove(context: AuthContext, userId: string): Promise<void> {
    if (userId === context.userId) throw new ValidationError('You cannot remove yourself');
    await this.access.requireUser(userId);

    const revoked = await this.keys.revokeAllForUser(userId);
    await this.uow.transaction(async (repos) => {
      await repos.users.delete(userId);
      await this.audit.record(
        context,
        {
          action: 'USER_REMOVED',
          targetType: 'user',
          targetId: userId,
          metadata: { revokedKeys: revoked },
        },
        repos,
      );
    });
  }

  /** Full replacement: the request states the complete set of models for this developer. */
  async setModelAccess(
    context: AuthContext,
    userId: string,
    request: SetModelAccessRequest,
  ): Promise<Array<{ id: string; publicModelName: string }>> {
    await this.access.requireUser(userId);

    const models = await this.uow.repos.models.findMany(request.modelIds);
    if (models.length !== new Set(request.modelIds).size) throw new NotFoundError('Model');

    await this.uow.transaction(async (repos) => {
      await repos.modelAccess.replaceForUser(
        userId,
        models.map((model) => model.id),
      );
      await this.audit.record(
        context,
        {
          action: 'MODEL_ACCESS_UPDATED',
          targetType: 'user',
          targetId: userId,
          metadata: { models: models.map((model) => model.publicModelName) },
        },
        repos,
      );
    });

    await this.access.syncActiveKeys(userId);
    return models.map((model) => ({ id: model.id, publicModelName: model.publicModelName }));
  }
}
