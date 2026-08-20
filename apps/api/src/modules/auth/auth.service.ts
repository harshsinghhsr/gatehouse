import type { LoginRequest, MeResponse, RegisterRequest, Role, SessionUser } from '@gatehouse/shared';
import type { Config } from '../../core/config.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../core/errors.js';
import type { UnitOfWork } from '../../core/unit-of-work.js';
import type { AuditService } from '../audit/audit.service.js';
import { slugify } from '../organizations/slug.js';
import type { PasswordHasher } from './password.js';
import type { Session, SessionStore } from './session.store.js';

export type SignedIn = { sessionId: string; user: SessionUser; organizationId: string };

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

    const memberships = await this.uow.repos.memberships.listByUser(user.id);
    const membership = memberships[0];
    if (!membership) throw new ForbiddenError('This account belongs to no organization');

    const sessionId = await this.sessions.create({
      userId: user.id,
      organizationId: membership.organizationId,
    });
    return {
      sessionId,
      organizationId: membership.organizationId,
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
    const slug = await this.reserveSlug(slugify(request.organizationName));

    const { user, organizationId } = await this.uow.transaction(async (repos) => {
      const organization = await repos.organizations.create({ name: request.organizationName, slug });
      const user = await repos.users.create({ email: request.email, name: request.name, passwordHash });
      await repos.memberships.create({ organizationId: organization.id, userId: user.id, role: 'OWNER' });

      await this.audit.record(
        { organizationId: organization.id, userId: user.id, ip },
        {
          action: 'USER_CREATED',
          targetType: 'user',
          targetId: user.id,
          metadata: { email: user.email, role: 'OWNER', bootstrap: true },
        },
        repos,
      );
      return { user, organizationId: organization.id };
    });

    return {
      sessionId: await this.sessions.create({ userId: user.id, organizationId }),
      organizationId,
      user,
    };
  }

  async signOut(sessionId: string | undefined): Promise<void> {
    if (sessionId) await this.sessions.destroy(sessionId);
  }

  async describe(session: Session, role: Role): Promise<MeResponse> {
    const user = await this.uow.repos.users.findById(session.userId);
    if (!user) throw new NotFoundError('User');

    const memberships = await this.uow.repos.memberships.listByUser(user.id);
    return {
      user,
      role,
      activeOrganizationId: session.organizationId,
      organizations: memberships.map((membership) => ({
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
        role: membership.role,
      })),
    };
  }

  private async reserveSlug(base: string): Promise<string> {
    for (let suffix = 0; suffix < 100; suffix++) {
      const candidate = suffix === 0 ? base : `${base}-${suffix}`;
      if (!(await this.uow.repos.organizations.slugExists(candidate))) return candidate;
    }
    throw new ConflictError('Could not derive a unique organization slug');
  }
}
