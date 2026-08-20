import type { CreateTeamRequest, TeamDetail, TeamSummary } from '@gatehouse/shared';
import { NotFoundError } from '../../core/errors.js';
import type { LlmGateway } from '../../core/gateway.js';
import type { UnitOfWork } from '../../core/unit-of-work.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/authenticator.js';
import type { AccessService } from '../developers/access.service.js';
import type { OrganizationService } from '../organizations/organization.service.js';
import { slugify } from '../organizations/slug.js';

/**
 * Teams grant models to a group. Any change here can widen or narrow what a member may call,
 * so every mutation re-syncs the affected members' live keys.
 */
export class TeamService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly gateway: LlmGateway,
    private readonly organizations: OrganizationService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<TeamSummary[]> {
    const teams = await this.uow.repos.teams.listByOrganization(organizationId);
    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      slug: team.slug,
      memberCount: team.memberCount,
    }));
  }

  async get(organizationId: string, id: string): Promise<TeamDetail> {
    const team = await this.require(organizationId, id);
    const [members, grants] = await Promise.all([
      this.uow.repos.teams.listMembers(team.id),
      this.uow.repos.modelAccess.listForTeam(organizationId, team.id),
    ]);

    return {
      id: team.id,
      name: team.name,
      slug: team.slug,
      memberCount: members.length,
      members,
      models: grants.map((grant) => ({ id: grant.providerModelId, publicModelName: grant.publicModelName })),
    };
  }

  async create(context: AuthContext, request: CreateTeamRequest): Promise<TeamSummary> {
    const gatewayOrgId = await this.organizations.ensureGatewayOrganization(context.organizationId);
    const gatewayTeamId = await this.gateway.createTeam(request.name, gatewayOrgId);

    const team = await this.uow.transaction(async (repos) => {
      const created = await repos.teams.create({
        organizationId: context.organizationId,
        name: request.name,
        slug: slugify(request.name),
        litellmTeamId: gatewayTeamId,
      });
      await this.audit.record(
        context,
        { action: 'TEAM_CREATED', targetType: 'team', targetId: created.id, metadata: { name: request.name } },
        repos,
      );
      return created;
    });

    return { id: team.id, name: team.name, slug: team.slug, memberCount: 0 };
  }

  async delete(context: AuthContext, id: string): Promise<void> {
    const team = await this.require(context.organizationId, id);
    const memberIds = await this.uow.repos.teams.listMemberIds(team.id);

    await this.uow.transaction(async (repos) => {
      await repos.teams.delete(team.id);
      await this.audit.record(
        context,
        { action: 'TEAM_DELETED', targetType: 'team', targetId: team.id, metadata: { name: team.name } },
        repos,
      );
    });

    // Members may have just lost model access along with the team.
    for (const userId of memberIds) {
      await this.access.syncActiveKeys(context.organizationId, userId);
    }
  }

  async addMember(context: AuthContext, teamId: string, userId: string): Promise<void> {
    const team = await this.require(context.organizationId, teamId);
    await this.access.requireMembership(context.organizationId, userId);

    await this.uow.repos.teams.addMember(team.id, userId);
    if (team.litellmTeamId) {
      const gatewayUserId = await this.organizations.ensureGatewayUser(context.organizationId, userId);
      await this.gateway.addTeamMember(team.litellmTeamId, gatewayUserId);
    }
    await this.access.syncActiveKeys(context.organizationId, userId);

    await this.audit.record(context, {
      action: 'TEAM_MEMBER_ADDED',
      targetType: 'team',
      targetId: team.id,
      metadata: { userId },
    });
  }

  async removeMember(context: AuthContext, teamId: string, userId: string): Promise<void> {
    const team = await this.require(context.organizationId, teamId);

    await this.uow.repos.teams.removeMember(team.id, userId);
    await this.access.syncActiveKeys(context.organizationId, userId);

    await this.audit.record(context, {
      action: 'TEAM_MEMBER_REMOVED',
      targetType: 'team',
      targetId: team.id,
      metadata: { userId },
    });
  }

  async setModelAccess(
    context: AuthContext,
    teamId: string,
    modelIds: string[],
  ): Promise<Array<{ id: string; publicModelName: string }>> {
    const team = await this.require(context.organizationId, teamId);
    const models = await this.uow.repos.models.findManyInOrganization(modelIds, context.organizationId);
    if (models.length !== new Set(modelIds).size) throw new NotFoundError('Model');

    await this.uow.transaction(async (repos) => {
      await repos.modelAccess.replaceForTeam(
        context.organizationId,
        team.id,
        models.map((model) => model.id),
      );
      await this.audit.record(
        context,
        {
          action: 'MODEL_ACCESS_UPDATED',
          targetType: 'team',
          targetId: team.id,
          metadata: { models: models.map((model) => model.publicModelName) },
        },
        repos,
      );
    });

    for (const userId of await this.uow.repos.teams.listMemberIds(team.id)) {
      await this.access.syncActiveKeys(context.organizationId, userId);
    }
    return models.map((model) => ({ id: model.id, publicModelName: model.publicModelName }));
  }

  private async require(organizationId: string, id: string) {
    const team = await this.uow.repos.teams.findInOrganization(id, organizationId);
    if (!team) throw new NotFoundError('Team');
    return team;
  }
}
