import type { AuditRepository } from '../modules/audit/audit.repository.js';
import type { BudgetRepository } from '../modules/developers/budget.repository.js';
import type { GatewayKeyRepository } from '../modules/developers/gateway-key.repository.js';
import type { ModelAccessRepository } from '../modules/developers/model-access.repository.js';
import type { MembershipRepository } from '../modules/organizations/membership.repository.js';
import type { OrganizationRepository } from '../modules/organizations/organization.repository.js';
import type { UserRepository } from '../modules/organizations/user.repository.js';
import type { ProviderModelRepository } from '../modules/models/provider-model.repository.js';
import type { ProviderRepository } from '../modules/providers/provider.repository.js';
import type { TeamRepository } from '../modules/teams/team.repository.js';

/** Every repository, as seen by a service. Concrete implementations live in src/infra/db. */
export interface Repositories {
  organizations: OrganizationRepository;
  users: UserRepository;
  memberships: MembershipRepository;
  teams: TeamRepository;
  providers: ProviderRepository;
  models: ProviderModelRepository;
  modelAccess: ModelAccessRepository;
  keys: GatewayKeyRepository;
  budgets: BudgetRepository;
  audit: AuditRepository;
}

/**
 * Transaction boundary. A service that changes more than one table wraps the change in
 * `transaction`, and the repositories it receives inside are bound to that transaction —
 * so a mutation and its audit row commit together or not at all.
 */
export interface UnitOfWork {
  readonly repos: Repositories;
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}
