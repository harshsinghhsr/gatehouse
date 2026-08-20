import type { KeyStatus } from '@gatehouse/shared';
import type { Db } from '../../infra/db/client.js';

/**
 * A reference to a key that lives in LiteLLM. The plaintext is shown once at creation and
 * never stored, so `keyAlias` is the handle used to revoke and rotate.
 */
export type GatewayKeyReference = {
  id: string;
  organizationId: string;
  userId: string | null;
  teamId: string | null;
  keyAlias: string;
  litellmKeyId: string;
  keyPrefix: string | null;
  status: KeyStatus;
  createdAt: Date;
  revokedAt: Date | null;
};

export interface GatewayKeyRepository {
  listForUser(organizationId: string, userId: string): Promise<GatewayKeyReference[]>;
  listActiveForUser(organizationId: string, userId: string): Promise<GatewayKeyReference[]>;
  countActiveByUser(organizationId: string): Promise<Map<string, number>>;
  findInOrganization(id: string, organizationId: string): Promise<GatewayKeyReference | null>;
  create(input: {
    organizationId: string;
    userId: string;
    keyAlias: string;
    litellmKeyId: string;
    keyPrefix: string;
    expiresAt: Date | null;
  }): Promise<GatewayKeyReference>;
  markInactive(id: string, status: Extract<KeyStatus, 'REVOKED' | 'ROTATED'>, at: Date): Promise<void>;
}

const SELECT = {
  id: true,
  organizationId: true,
  userId: true,
  teamId: true,
  keyAlias: true,
  litellmKeyId: true,
  keyPrefix: true,
  status: true,
  createdAt: true,
  revokedAt: true,
} as const;

export class PrismaGatewayKeyRepository implements GatewayKeyRepository {
  constructor(private readonly db: Db) {}

  listForUser(organizationId: string, userId: string): Promise<GatewayKeyReference[]> {
    return this.db.gatewayKeyReference.findMany({
      where: { organizationId, userId },
      select: SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  listActiveForUser(organizationId: string, userId: string): Promise<GatewayKeyReference[]> {
    return this.db.gatewayKeyReference.findMany({
      where: { organizationId, userId, status: 'ACTIVE' },
      select: SELECT,
    });
  }

  async countActiveByUser(organizationId: string): Promise<Map<string, number>> {
    const rows = await this.db.gatewayKeyReference.groupBy({
      by: ['userId'],
      where: { organizationId, status: 'ACTIVE' },
      _count: true,
    });
    return new Map(rows.flatMap((row) => (row.userId ? [[row.userId, row._count] as const] : [])));
  }

  findInOrganization(id: string, organizationId: string): Promise<GatewayKeyReference | null> {
    return this.db.gatewayKeyReference.findFirst({ where: { id, organizationId }, select: SELECT });
  }

  create(input: {
    organizationId: string;
    userId: string;
    keyAlias: string;
    litellmKeyId: string;
    keyPrefix: string;
    expiresAt: Date | null;
  }): Promise<GatewayKeyReference> {
    return this.db.gatewayKeyReference.create({ data: input, select: SELECT });
  }

  async markInactive(id: string, status: 'REVOKED' | 'ROTATED', at: Date): Promise<void> {
    await this.db.gatewayKeyReference.update({ where: { id }, data: { status, revokedAt: at } });
  }
}
