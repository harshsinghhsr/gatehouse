import type { Db } from '../../infra/db/client.js';
import { onUniqueConflict } from '../../infra/db/conflicts.js';

export type Team = {
  id: string;
  name: string;
  slug: string;
  litellmTeamId: string | null;
};

export type TeamMember = { id: string; name: string; email: string };

export interface TeamRepository {
  list(): Promise<Array<Team & { memberCount: number }>>;
  findById(id: string): Promise<Team | null>;
  listForUser(userId: string): Promise<Team[]>;
  listMembers(teamId: string): Promise<TeamMember[]>;
  listMemberIds(teamId: string): Promise<string[]>;
  create(input: { name: string; slug: string; litellmTeamId: string | null }): Promise<Team>;
  delete(id: string): Promise<void>;
  addMember(teamId: string, userId: string): Promise<void>;
  removeMember(teamId: string, userId: string): Promise<void>;
}

const SELECT = { id: true, name: true, slug: true, litellmTeamId: true } as const;

export class PrismaTeamRepository implements TeamRepository {
  constructor(private readonly db: Db) {}

  async list() {
    const rows = await this.db.team.findMany({
      select: { ...SELECT, _count: { select: { members: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(({ _count, ...team }) => ({ ...team, memberCount: _count.members }));
  }

  findById(id: string): Promise<Team | null> {
    return this.db.team.findUnique({ where: { id }, select: SELECT });
  }

  listForUser(userId: string): Promise<Team[]> {
    return this.db.team.findMany({
      where: { members: { some: { userId } } },
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

  create(input: { name: string; slug: string; litellmTeamId: string | null }): Promise<Team> {
    return onUniqueConflict(
      { slug: 'Another team already uses a name that resolves to the same slug' },
      () => this.db.team.create({ data: input, select: SELECT }),
    );
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
