import { NotFoundError } from '../../core/errors.js';
import type { LlmGateway } from '../../core/gateway.js';
import type { UnitOfWork } from '../../core/unit-of-work.js';

export class UserService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly gateway: LlmGateway,
  ) {}

  /** The gateway-side user, created on first use so the mirror stays lazy. */
  async ensureGatewayUser(userId: string): Promise<string> {
    const existing = await this.uow.repos.users.findLitellmUserId(userId);
    if (existing) return existing;

    const user = await this.uow.repos.users.findById(userId);
    if (!user) throw new NotFoundError('Developer');

    const gatewayUserId = await this.gateway.createUser(user.email);
    await this.uow.repos.users.setLitellmUserId(userId, gatewayUserId);
    return gatewayUserId;
  }
}
