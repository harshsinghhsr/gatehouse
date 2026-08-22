import type { ProviderType } from '@gatehouse/shared';
import type { Db } from '../../infra/db/client.js';
import { onUniqueConflict } from '../../infra/db/conflicts.js';

export type ProviderModel = {
  id: string;
  providerId: string;
  /** What developers type. */
  publicModelName: string;
  /** What the provider calls it: an Azure deployment name, or the vendor's model id. */
  providerModelName: string;
  /** Globally unique inside the gateway: "{providerSlug}/{publicModelName}". */
  gatewayModelName: string;
  litellmModelId: string | null;
  enabled: boolean;
  provider: { id: string; name: string; type: ProviderType; litellmCredentialName: string | null };
};

export interface ProviderModelRepository {
  list(): Promise<ProviderModel[]>;
  listByProvider(providerId: string): Promise<ProviderModel[]>;
  findById(id: string): Promise<ProviderModel | null>;
  findMany(ids: string[]): Promise<ProviderModel[]>;
  countEnabled(): Promise<number>;
  create(input: {
    providerId: string;
    publicModelName: string;
    providerModelName: string;
    gatewayModelName: string;
    litellmModelId: string | null;
  }): Promise<ProviderModel>;
  update(id: string, patch: { enabled?: boolean; litellmModelId?: string | null }): Promise<ProviderModel>;
  delete(id: string): Promise<void>;
}

const SELECT = {
  id: true,
  providerId: true,
  publicModelName: true,
  providerModelName: true,
  litellmModelName: true,
  litellmModelId: true,
  enabled: true,
  provider: { select: { id: true, name: true, type: true, litellmCredentialName: true } },
} as const;

/**
 * Both uniques describe the same collision from two sides: the gateway name is built from the
 * provider slug and the public name, so a duplicate public name under one provider trips
 * whichever index Postgres reaches first.
 */
const MODEL_NAME_TAKEN = {
  publicModelName: 'This provider already publishes a model with this public name',
  litellmModelName: 'This provider already publishes a model with this public name',
} as const;

type Row = Omit<ProviderModel, 'gatewayModelName'> & { litellmModelName: string };
const toDomain = ({ litellmModelName, ...row }: Row): ProviderModel => ({
  ...row,
  gatewayModelName: litellmModelName,
});

export class PrismaProviderModelRepository implements ProviderModelRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<ProviderModel[]> {
    const rows = await this.db.providerModel.findMany({
      select: SELECT,
      orderBy: { publicModelName: 'asc' },
    });
    return rows.map(toDomain);
  }

  async listByProvider(providerId: string): Promise<ProviderModel[]> {
    const rows = await this.db.providerModel.findMany({
      where: { providerId },
      select: SELECT,
      orderBy: { publicModelName: 'asc' },
    });
    return rows.map(toDomain);
  }

  async findById(id: string): Promise<ProviderModel | null> {
    const row = await this.db.providerModel.findUnique({ where: { id }, select: SELECT });
    return row ? toDomain(row) : null;
  }

  async findMany(ids: string[]): Promise<ProviderModel[]> {
    const rows = await this.db.providerModel.findMany({ where: { id: { in: ids } }, select: SELECT });
    return rows.map(toDomain);
  }

  countEnabled(): Promise<number> {
    return this.db.providerModel.count({ where: { enabled: true } });
  }

  async create(input: {
    providerId: string;
    publicModelName: string;
    providerModelName: string;
    gatewayModelName: string;
    litellmModelId: string | null;
  }): Promise<ProviderModel> {
    const { gatewayModelName, ...rest } = input;
    return toDomain(
      await onUniqueConflict(MODEL_NAME_TAKEN, () =>
        this.db.providerModel.create({
          data: { ...rest, litellmModelName: gatewayModelName },
          select: SELECT,
        }),
      ),
    );
  }

  async update(id: string, patch: { enabled?: boolean; litellmModelId?: string | null }): Promise<ProviderModel> {
    return toDomain(
      await onUniqueConflict(MODEL_NAME_TAKEN, () =>
        this.db.providerModel.update({ where: { id }, data: patch, select: SELECT }),
      ),
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.providerModel.delete({ where: { id } });
  }
}
