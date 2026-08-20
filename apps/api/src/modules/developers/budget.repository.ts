import type { BudgetPeriod } from '@gatehouse/shared';
import type { Db } from '../../infra/db/client.js';

export type Budget = {
  id: string;
  organizationId: string;
  userId: string | null;
  teamId: string | null;
  maxBudget: number;
  period: BudgetPeriod;
  rpmLimit: number | null;
  tpmLimit: number | null;
};

export type BudgetWithHolder = Budget & {
  user: { id: string; name: string; email: string } | null;
  team: { id: string; name: string } | null;
};

export interface BudgetRepository {
  findForUser(organizationId: string, userId: string): Promise<Budget | null>;
  listByOrganization(organizationId: string): Promise<BudgetWithHolder[]>;
  upsertForUser(
    organizationId: string,
    userId: string,
    values: { maxBudget: number; period: BudgetPeriod; rpmLimit: number | null; tpmLimit: number | null },
  ): Promise<Budget>;
}

const SELECT = {
  id: true,
  organizationId: true,
  userId: true,
  teamId: true,
  maxBudget: true,
  period: true,
  rpmLimit: true,
  tpmLimit: true,
} as const;

type Row = Omit<Budget, 'maxBudget'> & { maxBudget: unknown };
const toDomain = (row: Row): Budget => ({ ...row, maxBudget: Number(row.maxBudget) });

export class PrismaBudgetRepository implements BudgetRepository {
  constructor(private readonly db: Db) {}

  async findForUser(organizationId: string, userId: string): Promise<Budget | null> {
    const row = await this.db.budget.findFirst({
      where: { organizationId, userId, teamId: null },
      select: SELECT,
    });
    return row ? toDomain(row) : null;
  }

  async listByOrganization(organizationId: string): Promise<BudgetWithHolder[]> {
    const rows = await this.db.budget.findMany({
      where: { organizationId },
      select: {
        ...SELECT,
        user: { select: { id: true, name: true, email: true } },
        team: { select: { id: true, name: true } },
      },
    });
    return rows.map((row) => ({ ...toDomain(row), user: row.user, team: row.team }));
  }

  /**
   * Not a Prisma upsert: the compound unique includes a nullable teamId, which Postgres
   * treats as never equal, so the unique index cannot be targeted.
   */
  async upsertForUser(
    organizationId: string,
    userId: string,
    values: { maxBudget: number; period: BudgetPeriod; rpmLimit: number | null; tpmLimit: number | null },
  ): Promise<Budget> {
    const existing = await this.db.budget.findFirst({
      where: { organizationId, userId, teamId: null },
      select: { id: true },
    });

    const row = existing
      ? await this.db.budget.update({ where: { id: existing.id }, data: values, select: SELECT })
      : await this.db.budget.create({ data: { organizationId, userId, ...values }, select: SELECT });
    return toDomain(row);
  }
}
