import type {
  CreateTeamRequest,
  TeamCandidate,
  TeamDetail,
  TeamRole,
  TeamSummary,
} from '@gatehouse/shared';
import { ForbiddenError, NotFoundError } from '../../core/errors.js';
import type { LlmGateway } from '../../core/gateway.js';
import { slugify } from '../../core/slug.js';
import type { UnitOfWork } from '../../core/unit-of-work.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/authenticator.js';
import type { AccessService } from '../developers/access.service.js';
import type { UserService } from '../users/user.service.js';

/** Instance-wide authority. OWNER and ADMIN manage every team; everyone else must lead it. */
function isInstanceAdmin(context: AuthContext): boolean {
  return context.role === 'OWNER' || context.role === 'ADMIN';
}

/**
 * Teams grant models to a group. Any change here can widen or narrow what a member may call,
 * so every mutation re-syncs the affected members' live keys.
 */
export class TeamService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly gateway: LlmGateway,
    private readonly users: UserService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<TeamSummary[]> {
    const teams = await this.uow.repos.teams.list();
    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      slug: team.slug,
      memberCount: team.memberCount,
    }));
  }

  async get(id: string): Promise<TeamDetail> {
    const team = await this.require(id);
    const [members, grants] = await Promise.all([
      this.uow.repos.teams.listMembers(team.id),
      this.uow.repos.modelAccess.listForTeam(team.id),
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

  /**
   * Who a manager may still add. Deliberately narrower than `GET /developers`: a lead needs a
   * name and an id to fill a dropdown, not the roster's budgets, grants and key counts.
   */
  async listCandidates(context: AuthContext, teamId: string): Promise<TeamCandidate[]> {
    await this.assertCanManage(context, teamId);
    return this.uow.repos.teams.listCandidates(teamId);
  }

  async create(context: AuthContext, request: CreateTeamRequest): Promise<TeamSummary> {
    const gatewayTeamId = await this.gateway.createTeam(request.name);

    const team = await this.uow.transaction(async (repos) => {
      const created = await repos.teams.create({
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
    const team = await this.require(id);
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
      await this.access.syncActiveKeys(userId);
    }
  }

  async addMember(
    context: AuthContext,
    teamId: string,
    userId: string,
    role: TeamRole = 'MEMBER',
  ): Promise<void> {
    this.assertMayAppoint(context, role);
    await this.assertCanManage(context, teamId);
    // The upsert overwrites an existing row's role, so demotion is a write like any other.
    await this.assertMayTouchLead(context, teamId, userId, 'change');
    const team = await this.require(teamId);
    await this.access.requireUser(userId);

    await this.uow.repos.teams.addMember(team.id, userId, role);
    if (team.litellmTeamId) {
      const gatewayUserId = await this.users.ensureGatewayUser(userId);
      await this.gateway.addTeamMember(team.litellmTeamId, gatewayUserId);
    }
    await this.access.syncActiveKeys(userId);

    await this.audit.record(context, {
      action: 'TEAM_MEMBER_ADDED',
      targetType: 'team',
      targetId: team.id,
      metadata: { userId },
    });
  }

  async removeMember(context: AuthContext, teamId: string, userId: string): Promise<void> {
    await this.assertCanManage(context, teamId);
    // A lead may not remove a peer lead, for the same reason they may not appoint one.
    await this.assertMayTouchLead(context, teamId, userId, 'remove');
    const team = await this.require(teamId);

    await this.uow.repos.teams.removeMember(team.id, userId);
    await this.access.syncActiveKeys(userId);

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
    await this.assertCanManage(context, teamId);
    const team = await this.require(teamId);
    const models = await this.uow.repos.models.findMany(modelIds);
    if (models.length !== new Set(modelIds).size) throw new NotFoundError('Model');

    await this.uow.transaction(async (repos) => {
      await repos.modelAccess.replaceForTeam(
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
      await this.access.syncActiveKeys(userId);
    }
    return models.map((model) => ({ id: model.id, publicModelName: model.publicModelName }));
  }

  /**
   * Kept here rather than in a route guard: "does this caller lead this team" is a database
   * read, and controllers do not branch on domain state.
   */
  private async assertCanManage(context: AuthContext, teamId: string): Promise<void> {
    if (isInstanceAdmin(context)) return;
    const member = await this.uow.repos.teams.findMember(teamId, context.userId);
    if (member?.role !== 'LEAD') throw new ForbiddenError('You do not lead this team');
  }

  /**
   * A lead's membership row is admin-only whichever way it is written. Without this, a lead
   * could re-POST a peer lead as MEMBER — the upsert would demote them — and then remove them,
   * defeating the appoint/remove rules in two calls.
   */
  private async assertMayTouchLead(
    context: AuthContext,
    teamId: string,
    userId: string,
    verb: 'change' | 'remove',
  ): Promise<void> {
    if (isInstanceAdmin(context)) return;
    const target = await this.uow.repos.teams.findMember(teamId, userId);
    if (target?.role === 'LEAD') throw new ForbiddenError(`Only an admin can ${verb} a team lead`);
  }

  /** Only an admin appoints a lead — otherwise a lead could mint peers without oversight. */
  private assertMayAppoint(context: AuthContext, role: TeamRole): void {
    if (role === 'LEAD' && !isInstanceAdmin(context)) {
      throw new ForbiddenError('Only an admin can appoint a team lead');
    }
  }

  private async require(id: string) {
    const team = await this.uow.repos.teams.findById(id);
    if (!team) throw new NotFoundError('Team');
    return team;
  }
}
