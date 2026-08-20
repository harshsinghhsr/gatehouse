import type { Db } from '../../infra/db/client.js';

export type Team = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  litellmTeamId: string | null;
};

export type TeamMember = { id: string; name: string; email: string };

export interface TeamRepository {
  listByOrganization(organizationId: string): Promise<Array<Team & { memberCount: number }>>;
  findInOrganization(id: string, organizationId: string): Promise<Team | null>;
  listForUser(organizationId: string, userId: string): Promise<Team[]>;
  listMembers(teamId: string): Promise<TeamMember[]>;
  listMemberIds(teamId: string): Promise<string[]>;
  create(input: { organizationId: string; name: string; slug: string; litellmTeamId: string | null }): Promise<Team>;
  delete(id: string): Promise<void>;
  addMember(teamId: string, userId: string): Promise<void>;
  removeMember(teamId: string, userId: string): Promise<void>;
}

const SELECT = { id: true, organizationId: true, name: true, slug: true, litellmTeamId: true } as const;

export class PrismaTeamRepository implements TeamRepository {
  constructor(private readonly db: Db) {}

  async listByOrganization(organizationId: string) {
    const rows = await this.db.team.findMany({
      where: { organizationId },
      select: { ...SELECT, _count: { select: { members: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(({ _count, ...team }) => ({ ...team, memberCount: _count.members }));
  }

  findInOrganization(id: string, organizationId: string): Promise<Team | null> {
    return this.db.team.findFirst({ where: { id, organizationId }, select: SELECT });
  }

  listForUser(organizationId: string, userId: string): Promise<Team[]> {
    return this.db.team.findMany({
      where: { organizationId, members: { some: { userId } } },
      select: SELECT,
      orderBy: { name: 'asc' },
    });
  }

  async listMembers(teamId: string): Promise<TeamMember[]> {
    const rows = await this.db.teamMember.findMany({
      where: { teamId },
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    return rows.map((row) => row.user);
  }

  async listMemberIds(teamId: string): Promise<string[]> {
    const rows = await this.db.teamMember.findMany({ where: { teamId }, select: { userId: true } });
    return rows.map((row) => row.userId);
  }

  create(input: { organizationId: string; name: string; slug: string; litellmTeamId: string | null }): Promise<Team> {
    return this.db.team.create({ data: input, select: SELECT });
  }

  async delete(id: string): Promise<void> {
    await this.db.team.delete({ where: { id } });
  }

  async addMember(teamId: string, userId: string): Promise<void> {
    await this.db.teamMember.upsert({
      where: { teamId_userId: { teamId, userId } },
      create: { teamId, userId },
      update: {},
    });
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    await this.db.teamMember.deleteMany({ where: { teamId, userId } });
  }
}
