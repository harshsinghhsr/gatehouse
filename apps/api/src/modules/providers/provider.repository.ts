import type { ProviderStatus, ProviderType } from '@gatehouse/shared';
import type { Db } from '../../infra/db/client.js';

export type Provider = {
  id: string;
  name: string;
  /** Namespaces this provider's models in the gateway: "{slug}/{publicModelName}". */
  slug: string;
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
  list(): Promise<Array<Provider & { modelCount: number }>>;
  findById(id: string): Promise<Provider | null>;
  create(input: {
    id: string;
    name: string;
    slug: string;
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
  name: true,
  slug: true,
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

  async list() {
    const rows = await this.db.provider.findMany({
      select: { ...SELECT, _count: { select: { models: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({ ...toDomain(row), modelCount: row._count.models }));
  }

  async findById(id: string): Promise<Provider | null> {
    const row = await this.db.provider.findUnique({ where: { id }, select: SELECT });
    return row ? toDomain(row) : null;
  }

  async create(input: {
    id: string;
    name: string;
    slug: string;
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
