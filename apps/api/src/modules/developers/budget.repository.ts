import type { BudgetPeriod } from '@gatehouse/shared';
import { onUniqueConflict } from '../../infra/db/conflicts.js';
import type { Db } from '../../infra/db/client.js';

export type Budget = {
  id: string;
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
  findForUser(userId: string): Promise<Budget | null>;
  list(): Promise<BudgetWithHolder[]>;
  upsertForUser(
    userId: string,
    values: { maxBudget: number; period: BudgetPeriod; rpmLimit: number | null; tpmLimit: number | null },
  ): Promise<Budget>;
}

const SELECT = {
  id: true,
  userId: true,
  teamId: true,
  maxBudget: true,
  period: true,
  rpmLimit: true,
  tpmLimit: true,
} as const;

/** "Budget_subject_key" is reported by the pg adapter as its quoted columns: "userId", "teamId". */
const SUBJECT_TAKEN = { userId: 'This budget was just changed by someone else. Reload and try again.' };

type Row = Omit<Budget, 'maxBudget'> & { maxBudget: unknown };
const toDomain = (row: Row): Budget => ({ ...row, maxBudget: Number(row.maxBudget) });

export class PrismaBudgetRepository implements BudgetRepository {
  constructor(private readonly db: Db) {}

  async findForUser(userId: string): Promise<Budget | null> {
    const row = await this.db.budget.findFirst({
      where: { userId, teamId: null },
      select: SELECT,
    });
    return row ? toDomain(row) : null;
  }

  async list(): Promise<BudgetWithHolder[]> {
    const rows = await this.db.budget.findMany({
      select: {
        ...SELECT,
        user: { select: { id: true, name: true, email: true } },
        team: { select: { id: true, name: true } },
      },
    });
    return rows.map((row) => ({ ...toDomain(row), user: row.user, team: row.team }));
  }

  /**
   * Not a Prisma upsert: the constraint is the hand-written NULLS NOT DISTINCT index
   * "Budget_subject_key" (migration harden_schema_invariants), which Prisma cannot express and
   * therefore cannot target. The read-then-write is a race, so the insert is the loser's path:
   * two concurrent PATCHes both see no row, one inserts, the other gets a P2002 that becomes a
   * 409 instead of the second budget row that used to appear silently.
   */
  async upsertForUser(
    userId: string,
    values: { maxBudget: number; period: BudgetPeriod; rpmLimit: number | null; tpmLimit: number | null },
  ): Promise<Budget> {
    const existing = await this.db.budget.findFirst({
      where: { userId, teamId: null },
      select: { id: true },
    });

    const row = existing
      ? await this.db.budget.update({ where: { id: existing.id }, data: values, select: SELECT })
      : await onUniqueConflict(SUBJECT_TAKEN, () =>
          this.db.budget.create({ data: { userId, ...values }, select: SELECT }),
        );
    return toDomain(row);
  }
}
