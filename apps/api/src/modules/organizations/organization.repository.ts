import type { Db } from '../../infra/db/client.js';

export type Organization = {
  id: string;
  name: string;
  /** Namespaces this organization's models inside the shared gateway. */
  slug: string;
  litellmOrgId: string | null;
};

export interface OrganizationRepository {
  findById(id: string): Promise<Organization | null>;
  slugExists(slug: string): Promise<boolean>;
  create(input: { name: string; slug: string }): Promise<Organization>;
  setLitellmOrgId(id: string, litellmOrgId: string): Promise<void>;
}

const SELECT = { id: true, name: true, slug: true, litellmOrgId: true } as const;

export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly db: Db) {}

  findById(id: string): Promise<Organization | null> {
    return this.db.organization.findUnique({ where: { id }, select: SELECT });
  }

  async slugExists(slug: string): Promise<boolean> {
    return (await this.db.organization.count({ where: { slug } })) > 0;
  }

  create(input: { name: string; slug: string }): Promise<Organization> {
    return this.db.organization.create({ data: input, select: SELECT });
  }

  async setLitellmOrgId(id: string, litellmOrgId: string): Promise<void> {
    await this.db.organization.update({ where: { id }, data: { litellmOrgId } });
  }
}
