import type { Repositories, UnitOfWork } from '../../core/unit-of-work.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaAuditRepository } from '../../modules/audit/audit.repository.js';
import { PrismaBudgetRepository } from '../../modules/developers/budget.repository.js';
import { PrismaGatewayKeyRepository } from '../../modules/developers/gateway-key.repository.js';
import { PrismaModelAccessRepository } from '../../modules/developers/model-access.repository.js';
import { PrismaProviderModelRepository } from '../../modules/models/provider-model.repository.js';
import { PrismaMembershipRepository } from '../../modules/organizations/membership.repository.js';
import { PrismaOrganizationRepository } from '../../modules/organizations/organization.repository.js';
import { PrismaUserRepository } from '../../modules/organizations/user.repository.js';
import { PrismaProviderRepository } from '../../modules/providers/provider.repository.js';
import { PrismaTeamRepository } from '../../modules/teams/team.repository.js';
import type { Db } from './client.js';

function buildRepositories(db: Db): Repositories {
  return {
    organizations: new PrismaOrganizationRepository(db),
    users: new PrismaUserRepository(db),
    memberships: new PrismaMembershipRepository(db),
    teams: new PrismaTeamRepository(db),
    providers: new PrismaProviderRepository(db),
    models: new PrismaProviderModelRepository(db),
    modelAccess: new PrismaModelAccessRepository(db),
    keys: new PrismaGatewayKeyRepository(db),
    budgets: new PrismaBudgetRepository(db),
    audit: new PrismaAuditRepository(db),
  };
}

export class PrismaUnitOfWork implements UnitOfWork {
  readonly repos: Repositories;

  constructor(private readonly prisma: PrismaClient) {
    this.repos = buildRepositories(prisma);
  }

  /** Repositories handed to `work` are bound to the transaction, so writes commit together. */
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(buildRepositories(tx)));
  }
}
