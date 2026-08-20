import type { AuditAction, AuditEntry, AuditQuery } from '@gatehouse/shared';
import type { Repositories, UnitOfWork } from '../../core/unit-of-work.js';
import type { AuditRepository } from './audit.repository.js';

/** Structurally satisfied by AuthContext, so callers pass the context they already hold. */
export type AuditContext = {
  organizationId: string;
  userId: string | null;
  ip: string | null;
};

export type AuditEventInput = {
  action: AuditAction;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
};

/** Anything whose name suggests a credential is replaced before the row is written. */
const SECRET_KEY = /key|secret|password|token|credential/i;

export function scrubMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, SECRET_KEY.test(key) ? '[redacted]' : value]),
  );
}

export class AuditService {
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * Pass `repos` when recording inside a transaction, so the audit row and the change it
   * describes commit together. Without it the write goes on its own connection.
   */
  async record(context: AuditContext, event: AuditEventInput, repos?: Repositories): Promise<void> {
    const repository: AuditRepository = (repos ?? this.uow.repos).audit;
    await repository.append({
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      metadata: scrubMetadata(event.metadata ?? {}),
      ip: context.ip,
    });
  }

  async list(organizationId: string, query: AuditQuery): Promise<{ logs: AuditEntry[]; nextCursor: string | null }> {
    // Fetch one extra row to learn whether another page exists, then drop it.
    const rows = await this.uow.repos.audit.list({
      organizationId,
      action: query.action,
      cursor: query.cursor,
      limit: query.limit + 1,
    });

    const page = rows.slice(0, query.limit);
    return {
      logs: page.map((row) => ({
        id: row.id,
        action: row.action,
        actorUserId: row.actorUserId,
        targetType: row.targetType,
        targetId: row.targetId,
        metadata: row.metadata,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
