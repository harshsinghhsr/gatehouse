import type { AuditAction } from '@gatehouse/shared';
import type { Db } from '../../infra/db/client.js';

export type AuditRecord = {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  action: AuditAction;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: Date;
};

export type NewAuditRecord = Omit<AuditRecord, 'id' | 'createdAt'>;

export interface AuditRepository {
  append(record: NewAuditRecord): Promise<void>;
  list(query: {
    organizationId: string;
    action?: AuditAction | undefined;
    cursor?: string | undefined;
    limit: number;
  }): Promise<AuditRecord[]>;
}

const SELECT = {
  id: true,
  organizationId: true,
  actorUserId: true,
  action: true,
  targetType: true,
  targetId: true,
  metadata: true,
  ip: true,
  createdAt: true,
} as const;

type Row = Omit<AuditRecord, 'action' | 'metadata'> & { action: string; metadata: unknown };
const toDomain = (row: Row): AuditRecord => ({
  ...row,
  action: row.action as AuditAction,
  metadata: (row.metadata ?? {}) as Record<string, unknown>,
});

export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly db: Db) {}

  async append(record: NewAuditRecord): Promise<void> {
    await this.db.auditLog.create({
      data: { ...record, metadata: record.metadata as never },
    });
  }

  async list(query: {
    organizationId: string;
    action?: AuditAction | undefined;
    cursor?: string | undefined;
    limit: number;
  }): Promise<AuditRecord[]> {
    const rows = await this.db.auditLog.findMany({
      where: { organizationId: query.organizationId, ...(query.action ? { action: query.action } : {}) },
      select: SELECT,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return rows.map(toDomain);
  }
}
