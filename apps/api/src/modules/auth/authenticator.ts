import type { Role } from '@gatehouse/shared';
import { ForbiddenError, UnauthorizedError } from '../../core/errors.js';
import type { UnitOfWork } from '../../core/unit-of-work.js';
import type { SessionStore } from './session.store.js';

/**
 * The authenticated caller. `organizationId` originates here, from the session — never from a
 * request body or query — which is what makes tenant isolation enforceable in one place.
 */
export type AuthContext = {
  userId: string;
  organizationId: string;
  role: Role;
  ip: string | null;
};

const RANK: Record<Role, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };

export class Authenticator {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly sessions: SessionStore,
  ) {}

  async authenticate(sessionId: string | undefined, ip: string | null): Promise<AuthContext> {
    if (!sessionId) throw new UnauthorizedError();

    const session = await this.sessions.read(sessionId);
    if (!session) throw new UnauthorizedError('Session expired');

    // Re-read the membership on every request: a revoked role or a disabled account must
    // take effect immediately, not whenever the session happens to expire.
    const membership = await this.uow.repos.memberships.findWithUser(
      session.organizationId,
      session.userId,
    );
    if (!membership || membership.user.status !== 'ACTIVE') throw new UnauthorizedError();

    return {
      userId: session.userId,
      organizationId: session.organizationId,
      role: membership.role,
      ip,
    };
  }

  static assertRole(context: AuthContext, minimum: Role): void {
    if (RANK[context.role] < RANK[minimum]) {
      throw new ForbiddenError(`This action requires the ${minimum.toLowerCase()} role`);
    }
  }
}
