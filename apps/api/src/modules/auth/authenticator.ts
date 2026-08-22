import type { Role } from '@gatehouse/shared';
import { ForbiddenError, UnauthorizedError } from '../../core/errors.js';
import type { UnitOfWork } from '../../core/unit-of-work.js';
import type { SessionStore } from './session.store.js';

/**
 * The authenticated caller. `userId` and `role` originate here, from the session and the user
 * row — never from a request body or query — which is what keeps authorization enforceable in
 * one place.
 */
export type AuthContext = {
  userId: string;
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

    // Re-read the user on every request: a revoked role or a disabled account must take effect
    // immediately, not whenever the session happens to expire.
    const user = await this.uow.repos.users.findById(session.userId);
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedError();

    return { userId: user.id, role: user.role, ip };
  }

  static assertRole(context: AuthContext, minimum: Role): void {
    if (RANK[context.role] < RANK[minimum]) {
      throw new ForbiddenError(`This action requires the ${minimum.toLowerCase()} role`);
    }
  }
}
