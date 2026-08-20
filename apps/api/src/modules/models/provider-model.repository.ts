import type { ProviderType } from '@gatehouse/shared';
import type { Db } from '../../infra/db/client.js';

export type ProviderModel = {
  id: string;
  providerId: string;
  /** What developers type. */
  publicModelName: string;
  /** What the provider calls it: an Azure deployment name, or the vendor's model id. */
  providerModelName: string;
  /** Globally unique inside the gateway: "{orgSlug}/{publicModelName}". */
  gatewayModelName: string;
  litellmModelId: string | null;
  enabled: boolean;
  provider: { id: string; name: string; type: ProviderType; litellmCredentialName: string | null };
};

export interface ProviderModelRepository {
  listByOrganization(organizationId: string): Promise<ProviderModel[]>;
  listByProvider(providerId: string): Promise<ProviderModel[]>;
  findInOrganization(id: string, organizationId: string): Promise<ProviderModel | null>;
  findManyInOrganization(ids: string[], organizationId: string): Promise<ProviderModel[]>;
  countEnabled(organizationId: string): Promise<number>;
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

type Row = Omit<ProviderModel, 'gatewayModelName'> & { litellmModelName: string };
const toDomain = ({ litellmModelName, ...row }: Row): ProviderModel => ({
  ...row,
  gatewayModelName: litellmModelName,
});

export class PrismaProviderModelRepository implements ProviderModelRepository {
  constructor(private readonly db: Db) {}

  async listByOrganization(organizationId: string): Promise<ProviderModel[]> {
    const rows = await this.db.providerModel.findMany({
      where: { provider: { organizationId } },
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

  async findInOrganization(id: string, organizationId: string): Promise<ProviderModel | null> {
    const row = await this.db.providerModel.findFirst({
      where: { id, provider: { organizationId } },
      select: SELECT,
    });
    return row ? toDomain(row) : null;
  }

  async findManyInOrganization(ids: string[], organizationId: string): Promise<ProviderModel[]> {
    const rows = await this.db.providerModel.findMany({
      where: { id: { in: ids }, provider: { organizationId } },
      select: SELECT,
    });
    return rows.map(toDomain);
  }

  countEnabled(organizationId: string): Promise<number> {
    return this.db.providerModel.count({ where: { provider: { organizationId }, enabled: true } });
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
      await this.db.providerModel.create({
        data: { ...rest, litellmModelName: gatewayModelName },
        select: SELECT,
      }),
    );
  }

  async update(id: string, patch: { enabled?: boolean; litellmModelId?: string | null }): Promise<ProviderModel> {
    return toDomain(await this.db.providerModel.update({ where: { id }, data: patch, select: SELECT }));
  }

  async delete(id: string): Promise<void> {
    await this.db.providerModel.delete({ where: { id } });
  }
}
