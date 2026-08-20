import type { Redis } from 'ioredis';
import type { Logger as PinoLogger } from 'pino';
import type { Config } from './core/config.js';
import type { LlmGateway } from './core/gateway.js';
import { type Clock, systemClock } from './core/ports.js';
import type { UnitOfWork } from './core/unit-of-work.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { createGuards } from './http/plugins/auth.js';
import { RedisCacheStore, createRedis } from './infra/cache/redis-cache.js';
import { createPrismaClient } from './infra/db/client.js';
import { PrismaUnitOfWork } from './infra/db/prisma-unit-of-work.js';
import { LiteLlmGateway } from './infra/litellm/litellm-gateway.js';
import { asLogger } from './infra/logger.js';
import { createSecretStore } from './infra/secrets/secret-store.js';
import { AuditService } from './modules/audit/audit.service.js';
import { AuthService } from './modules/auth/auth.service.js';
import { Authenticator } from './modules/auth/authenticator.js';
import { ScryptPasswordHasher } from './modules/auth/password.js';
import { RedisSessionStore } from './modules/auth/session.store.js';
import { AccessService } from './modules/developers/access.service.js';
import { DeveloperService } from './modules/developers/developer.service.js';
import { KeyService } from './modules/developers/key.service.js';
import { ModelService } from './modules/models/model.service.js';
import { OrganizationService } from './modules/organizations/organization.service.js';
import { ProviderService } from './modules/providers/provider.service.js';
import { TeamService } from './modules/teams/team.service.js';
import { UsageService } from './modules/usage/usage.service.js';

/**
 * Composition root. Every dependency is constructed exactly once, here, and injected downward.
 * No module below this file constructs an adapter or reads process.env — which is what lets a
 * service be tested with an in-memory fake instead of a database.
 */
export type Services = {
  auth: AuthService;
  organizations: OrganizationService;
  providers: ProviderService;
  models: ModelService;
  developers: DeveloperService;
  keys: KeyService;
  teams: TeamService;
  usage: UsageService;
  audit: AuditService;
};

export type AppContainer = {
  config: Config;
  logger: PinoLogger;
  services: Services;
  guards: ReturnType<typeof createGuards>;
  healthChecks: Record<string, () => Promise<unknown>>;
  shutdown(): Promise<void>;
};

export type ContainerOverrides = {
  prisma?: PrismaClient;
  redis?: Redis;
  gateway?: LlmGateway;
  clock?: Clock;
};

export function createContainer(
  config: Config,
  logger: PinoLogger,
  overrides: ContainerOverrides = {},
): AppContainer {
  const prisma = overrides.prisma ?? createPrismaClient(config.databaseUrl);
  const redis = overrides.redis ?? createRedis(config.redisUrl);
  const clock = overrides.clock ?? systemClock;

  const uow: UnitOfWork = new PrismaUnitOfWork(prisma);
  const cache = new RedisCacheStore(redis);
  const secrets = createSecretStore(config);
  const sessions = new RedisSessionStore(redis, config.sessionTtlSeconds);
  const hasher = new ScryptPasswordHasher();

  // The master key stays inside this adapter: nothing above it can read or forward the value.
  const gateway =
    overrides.gateway ??
    new LiteLlmGateway({
      baseUrl: config.litellmBaseUrl,
      masterKey: config.litellmMasterKey,
      logger: asLogger(logger),
    });

  const audit = new AuditService(uow);
  const organizations = new OrganizationService(uow, gateway, sessions);
  const access = new AccessService(uow, gateway, organizations);
  const keys = new KeyService(uow, gateway, access, audit, clock);

  const services: Services = {
    audit,
    organizations,
    keys,
    auth: new AuthService(uow, sessions, hasher, audit, config),
    providers: new ProviderService(uow, gateway, secrets, audit, asLogger(logger), config),
    models: new ModelService(uow, gateway, audit),
    developers: new DeveloperService(uow, gateway, access, keys, hasher, audit),
    teams: new TeamService(uow, gateway, organizations, access, audit),
    usage: new UsageService(uow, gateway, organizations, cache, config),
  };

  return {
    config,
    logger,
    services,
    guards: createGuards(new Authenticator(uow, sessions)),
    healthChecks: {
      database: () => prisma.$queryRaw`SELECT 1`,
      redis: () => redis.ping(),
      gateway: () => gateway.health(),
    },
    async shutdown() {
      await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    },
  };
}
