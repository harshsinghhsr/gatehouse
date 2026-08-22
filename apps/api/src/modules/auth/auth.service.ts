import type { LoginRequest, MeResponse, RegisterRequest, Role, SessionUser } from '@gatehouse/shared';
import type { Config } from '../../core/config.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../core/errors.js';
import type { UnitOfWork } from '../../core/unit-of-work.js';
import type { AuditService } from '../audit/audit.service.js';
import type { PasswordHasher } from './password.js';
import type { Session, SessionStore } from './session.store.js';

export type SignedIn = { sessionId: string; user: SessionUser };

export class AuthService {
  /**
   * Verified against when an account does not exist, so a failed login costs the same time
   * whether or not the email is registered.
   */
  private readonly decoyHash: Promise<string>;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly sessions: SessionStore,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    private readonly config: Pick<Config, 'allowSignup'>,
  ) {
    this.decoyHash = this.hasher.hash(`decoy-${Math.random()}`);
  }

  async signIn(request: LoginRequest): Promise<SignedIn> {
    const user = await this.uow.repos.users.findByEmailWithSecret(request.email);
    const matches = await this.hasher.verify(request.password, user?.passwordHash ?? (await this.decoyHash));

    // One message for every failure mode: no account enumeration through error text.
    if (!user || !matches || user.status !== 'ACTIVE') {
      throw new UnauthorizedError('Invalid email or password');
    }

    return {
      sessionId: await this.sessions.create({ userId: user.id }),
      user: { id: user.id, email: user.email, name: user.name, status: user.status },
    };
  }

  /**
   * Bootstrap: the first account creates the platform and owns it. Afterwards sign-up is
   * closed and administrators invite people, unless it is explicitly reopened.
   */
  async register(request: RegisterRequest, ip: string | null): Promise<SignedIn> {
    if ((await this.uow.repos.users.countAll()) > 0 && !this.config.allowSignup) {
      throw new ForbiddenError('Sign-up is closed. Ask an administrator for an invitation.');
    }

    const passwordHash = await this.hasher.hash(request.password);

    const user = await this.uow.transaction(async (repos) => {
      const created = await repos.users.create({
        email: request.email,
        name: request.name,
        passwordHash,
        role: 'OWNER',
      });

      await this.audit.record(
        { userId: created.id, ip },
        {
          action: 'USER_CREATED',
          targetType: 'user',
          targetId: created.id,
          metadata: { email: created.email, role: 'OWNER', bootstrap: true },
        },
        repos,
      );
      return created;
    });

    return { sessionId: await this.sessions.create({ userId: user.id }), user };
  }

  async signOut(sessionId: string | undefined): Promise<void> {
    if (sessionId) await this.sessions.destroy(sessionId);
  }

  async describe(session: Session, role: Role): Promise<MeResponse> {
    const user = await this.uow.repos.users.findById(session.userId);
    if (!user) throw new NotFoundError('User');

    return { user, role };
  }
}
