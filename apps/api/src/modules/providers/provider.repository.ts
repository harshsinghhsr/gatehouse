import type { ProviderStatus, ProviderType } from '@gatehouse/shared';
import type { Db } from '../../infra/db/client.js';

export type Provider = {
  id: string;
  organizationId: string;
  name: string;
  type: ProviderType;
  status: ProviderStatus;
  /** Secrets Manager ARN or local reference. Never the credential itself. */
  secretRef: string;
  config: Record<string, string>;
  litellmCredentialName: string | null;
  lastTestedAt: Date | null;
  lastTestError: string | null;
};

export interface ProviderRepository {
  listByOrganization(organizationId: string): Promise<Array<Provider & { modelCount: number }>>;
  findInOrganization(id: string, organizationId: string): Promise<Provider | null>;
  create(input: {
    organizationId: string;
    name: string;
    type: ProviderType;
    secretRef: string;
    config: Record<string, string>;
  }): Promise<Provider>;
  update(
    id: string,
    patch: Partial<Pick<Provider, 'name' | 'status' | 'secretRef' | 'config' | 'litellmCredentialName' | 'lastTestedAt' | 'lastTestError'>>,
  ): Promise<Provider>;
  delete(id: string): Promise<void>;
}

const SELECT = {
  id: true,
  organizationId: true,
  name: true,
  type: true,
  status: true,
  secretRef: true,
  config: true,
  litellmCredentialName: true,
  lastTestedAt: true,
  lastTestError: true,
} as const;

type Row = { config: unknown } & Omit<Provider, 'config'>;
const toDomain = (row: Row): Provider => ({ ...row, config: (row.config ?? {}) as Record<string, string> });

export class PrismaProviderRepository implements ProviderRepository {
  constructor(private readonly db: Db) {}

  async listByOrganization(organizationId: string) {
    const rows = await this.db.provider.findMany({
      where: { organizationId },
      select: { ...SELECT, _count: { select: { models: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({ ...toDomain(row), modelCount: row._count.models }));
  }

  async findInOrganization(id: string, organizationId: string): Promise<Provider | null> {
    const row = await this.db.provider.findFirst({ where: { id, organizationId }, select: SELECT });
    return row ? toDomain(row) : null;
  }

  async create(input: {
    organizationId: string;
    name: string;
    type: ProviderType;
    secretRef: string;
    config: Record<string, string>;
  }): Promise<Provider> {
    return toDomain(await this.db.provider.create({ data: input, select: SELECT }));
  }

  async update(id: string, patch: Parameters<ProviderRepository['update']>[1]): Promise<Provider> {
    return toDomain(await this.db.provider.update({ where: { id }, data: patch, select: SELECT }));
  }

  async delete(id: string): Promise<void> {
    await this.db.provider.delete({ where: { id } });
  }
}
