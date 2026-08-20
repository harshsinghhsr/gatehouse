import type { OrganizationSummary } from '@gatehouse/shared';
import type { LlmGateway } from '../../core/gateway.js';
import { NotFoundError } from '../../core/errors.js';
import type { UnitOfWork } from '../../core/unit-of-work.js';
import type { AuthContext } from '../auth/authenticator.js';
import type { SessionStore } from '../auth/session.store.js';

export class OrganizationService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly gateway: LlmGateway,
    private readonly sessions: SessionStore,
  ) {}

  async listForUser(userId: string): Promise<OrganizationSummary[]> {
    const memberships = await this.uow.repos.memberships.listByUser(userId);
    return memberships.map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      role: membership.role,
    }));
  }

  /**
   * Switching organizations mints a new session id and drops the old one, so a stolen cookie
   * cannot be replayed against the organization the user just left.
   */
  async switchOrganization(
    context: AuthContext,
    organizationId: string,
    currentSessionId: string | undefined,
  ): Promise<{ sessionId: string }> {
    const membership = await this.uow.repos.memberships.find(organizationId, context.userId);
    if (!membership) throw new NotFoundError('Organization');

    if (currentSessionId) await this.sessions.destroy(currentSessionId);
    return { sessionId: await this.sessions.create({ userId: context.userId, organizationId }) };
  }

  /** The gateway-side organization, created on first use so the mirror stays lazy. */
  async ensureGatewayOrganization(organizationId: string): Promise<string> {
    const organization = await this.uow.repos.organizations.findById(organizationId);
    if (!organization) throw new NotFoundError('Organization');
    if (organization.litellmOrgId) return organization.litellmOrgId;

    const gatewayOrgId = await this.gateway.createOrganization(organization.slug);
    await this.uow.repos.organizations.setLitellmOrgId(organization.id, gatewayOrgId);
    return gatewayOrgId;
  }

  /** The gateway-side user for a membership. Gives LiteLLM something to attribute spend to. */
  async ensureGatewayUser(organizationId: string, userId: string): Promise<string> {
    const membership = await this.uow.repos.memberships.findWithUser(organizationId, userId);
    if (!membership) throw new NotFoundError('Developer');
    if (membership.litellmUserId) return membership.litellmUserId;

    const gatewayOrgId = await this.ensureGatewayOrganization(organizationId);
    const gatewayUserId = await this.gateway.createUser(membership.user.email, gatewayOrgId);
    await this.uow.repos.memberships.setLitellmUserId(membership.id, gatewayUserId);
    return gatewayUserId;
  }
}
