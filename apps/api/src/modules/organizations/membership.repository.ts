import type { Role } from '@gatehouse/shared';
import type { Db } from '../../infra/db/client.js';
import type { Organization } from './organization.repository.js';
import type { User } from './user.repository.js';

export type Membership = {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
  /** Mirrored LiteLLM internal user, so per-developer spend is queryable there. */
  litellmUserId: string | null;
};

export interface MembershipRepository {
  find(organizationId: string, userId: string): Promise<Membership | null>;
  findWithUser(organizationId: string, userId: string): Promise<(Membership & { user: User }) | null>;
  listByOrganization(organizationId: string): Promise<Array<Membership & { user: User }>>;
  listByUser(userId: string): Promise<Array<Membership & { organization: Organization }>>;
  listMirrored(organizationId: string): Promise<Array<Membership & { user: User }>>;
  countByOrganization(organizationId: string): Promise<number>;
  create(input: { organizationId: string; userId: string; role: Role }): Promise<Membership>;
  setRole(id: string, role: Role): Promise<void>;
  setLitellmUserId(id: string, litellmUserId: string): Promise<void>;
  delete(id: string): Promise<void>;
}

const SELECT = { id: true, organizationId: true, userId: true, role: true, litellmUserId: true } as const;
const USER = { select: { id: true, email: true, name: true, status: true } } as const;
const ORG = { select: { id: true, name: true, slug: true, litellmOrgId: true } } as const;

export class PrismaMembershipRepository implements MembershipRepository {
  constructor(private readonly db: Db) {}

  find(organizationId: string, userId: string): Promise<Membership | null> {
    return this.db.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: SELECT,
    });
  }

  findWithUser(organizationId: string, userId: string) {
    return this.db.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { ...SELECT, user: USER },
    });
  }

  listByOrganization(organizationId: string) {
    return this.db.membership.findMany({
      where: { organizationId },
      select: { ...SELECT, user: USER },
      orderBy: { createdAt: 'asc' },
    });
  }

  listByUser(userId: string) {
    return this.db.membership.findMany({
      where: { userId },
      select: { ...SELECT, organization: ORG },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Members that already exist in LiteLLM, i.e. those that can have usage attributed. */
  listMirrored(organizationId: string) {
    return this.db.membership.findMany({
      where: { organizationId, litellmUserId: { not: null } },
      select: { ...SELECT, user: USER },
    });
  }

  countByOrganization(organizationId: string): Promise<number> {
    return this.db.membership.count({ where: { organizationId } });
  }

  create(input: { organizationId: string; userId: string; role: Role }): Promise<Membership> {
    return this.db.membership.create({ data: input, select: SELECT });
  }

  async setRole(id: string, role: Role): Promise<void> {
    await this.db.membership.update({ where: { id }, data: { role } });
  }

  async setLitellmUserId(id: string, litellmUserId: string): Promise<void> {
    await this.db.membership.update({ where: { id }, data: { litellmUserId } });
  }

  async delete(id: string): Promise<void> {
    await this.db.membership.delete({ where: { id } });
  }
}
