import type { Db } from '../../infra/db/client.js';

/** A model a principal is allowed to call. Absence of a grant means denied. */
export type GrantedModel = {
  providerModelId: string;
  publicModelName: string;
  gatewayModelName: string;
};

export interface ModelAccessRepository {
  /** Union of the developer's own grants and those of every team they belong to. */
  listEffectiveForUser(userId: string): Promise<GrantedModel[]>;
  listForUser(userId: string): Promise<GrantedModel[]>;
  listForTeam(teamId: string): Promise<GrantedModel[]>;
  replaceForUser(userId: string, providerModelIds: string[]): Promise<void>;
  replaceForTeam(teamId: string, providerModelIds: string[]): Promise<void>;
}

const GRANT_SELECT = {
  providerModelId: true,
  providerModel: { select: { publicModelName: true, litellmModelName: true } },
} as const;

type GrantRow = {
  providerModelId: string;
  providerModel: { publicModelName: string; litellmModelName: string };
};

const toDomain = (row: GrantRow): GrantedModel => ({
  providerModelId: row.providerModelId,
  publicModelName: row.providerModel.publicModelName,
  gatewayModelName: row.providerModel.litellmModelName,
});

/** A grant only counts while both the model and its provider are switched on. */
const SERVING = { enabled: true, provider: { status: 'ACTIVE' as const } };

export class PrismaModelAccessRepository implements ModelAccessRepository {
  constructor(private readonly db: Db) {}

  async listEffectiveForUser(userId: string): Promise<GrantedModel[]> {
    const teams = await this.db.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });

    const rows = await this.db.modelAccess.findMany({
      where: {
        OR: [{ userId }, { teamId: { in: teams.map((t) => t.teamId) } }],
        providerModel: SERVING,
      },
      select: GRANT_SELECT,
    });

    const unique = new Map(rows.map((row) => [row.providerModelId, toDomain(row)]));
    return [...unique.values()];
  }

  async listForUser(userId: string): Promise<GrantedModel[]> {
    const rows = await this.db.modelAccess.findMany({
      where: { userId },
      select: GRANT_SELECT,
    });
    return rows.map(toDomain);
  }

  async listForTeam(teamId: string): Promise<GrantedModel[]> {
    const rows = await this.db.modelAccess.findMany({
      where: { teamId },
      select: GRANT_SELECT,
    });
    return rows.map(toDomain);
  }

  async replaceForUser(userId: string, providerModelIds: string[]): Promise<void> {
    await this.db.modelAccess.deleteMany({ where: { userId } });
    await this.db.modelAccess.createMany({
      data: providerModelIds.map((providerModelId) => ({ userId, providerModelId })),
    });
  }

  async replaceForTeam(teamId: string, providerModelIds: string[]): Promise<void> {
    await this.db.modelAccess.deleteMany({ where: { teamId } });
    await this.db.modelAccess.createMany({
      data: providerModelIds.map((providerModelId) => ({ teamId, providerModelId })),
    });
  }
}
