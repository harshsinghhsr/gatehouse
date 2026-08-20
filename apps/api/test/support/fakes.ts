import type { Redis } from 'ioredis';
import { pino } from 'pino';
import { type AppContainer, createContainer } from '../../src/container.js';
import { type Config, loadConfig } from '../../src/core/config.js';
import type { IssuedGatewayKey, KeySpec, LlmGateway, UsageReport } from '../../src/core/gateway.js';
import type { Repositories, UnitOfWork } from '../../src/core/unit-of-work.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Test doubles. Because every service takes its collaborators through the constructor, a unit
 * test can supply exactly the two or three methods the behaviour under test touches — and any
 * call the test did not anticipate fails loudly instead of silently returning undefined.
 */

export function autoStub<T extends object>(name: string, implemented: Partial<T>): T {
  return new Proxy(implemented as T, {
    get(target, property) {
      if (property in target) return Reflect.get(target, property);
      return () => {
        throw new Error(`${name}.${String(property)}() was called but not stubbed in this test`);
      };
    },
  });
}

export function stubRepositories(overrides: Partial<Repositories> = {}): Repositories {
  const named = <K extends keyof Repositories>(key: K): Repositories[K] =>
    overrides[key] ?? autoStub<Repositories[K] & object>(String(key), {});

  return {
    organizations: named('organizations'),
    users: named('users'),
    memberships: named('memberships'),
    teams: named('teams'),
    providers: named('providers'),
    models: named('models'),
    modelAccess: named('modelAccess'),
    keys: named('keys'),
    budgets: named('budgets'),
    audit: named('audit'),
  };
}

/** Runs the callback inline: a fake transaction is still a single logical unit for the test. */
export function fakeUnitOfWork(repos: Repositories): UnitOfWork {
  return { repos, transaction: (work) => work(repos) };
}

export type GatewayCall = { method: string; args: unknown[] };

export function fakeGateway(overrides: Partial<LlmGateway> = {}): LlmGateway & { calls: GatewayCall[] } {
  const calls: GatewayCall[] = [];
  const record =
    <T>(method: string, result: T) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return Promise.resolve(result);
    };

  const emptyUsage: UsageReport = {
    totalSpend: 0,
    totalRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    daily: [],
    byModel: {},
    byProvider: {},
  };

  const issued: IssuedGatewayKey = { secret: 'sk-test-plaintext-value', keyId: 'token-1', expiresAt: null };

  const base: LlmGateway = {
    issueKey: record('issueKey', issued) as (spec: KeySpec) => Promise<IssuedGatewayKey>,
    updateKey: record('updateKey', undefined),
    revokeKeyByAlias: record('revokeKeyByAlias', undefined),
    readKeyUsage: record('readKeyUsage', { spend: 0, maxBudget: null }),
    createOrganization: record('createOrganization', 'gw-org'),
    createUser: record('createUser', 'gw-user'),
    createTeam: record('createTeam', 'gw-team'),
    addTeamMember: record('addTeamMember', undefined),
    putCredential: record('putCredential', undefined),
    deleteCredential: record('deleteCredential', undefined),
    registerModel: record('registerModel', 'gw-model'),
    deregisterModel: record('deregisterModel', undefined),
    organizationUsage: record('organizationUsage', emptyUsage),
    userUsage: record('userUsage', emptyUsage),
    health: record('health', undefined),
  };

  return Object.assign({ ...base, ...overrides }, { calls });
}

const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://unused/unused',
  REDIS_URL: 'redis://unused',
  LITELLM_BASE_URL: 'http://gateway.invalid',
  LITELLM_MASTER_KEY: 'sk-test-master',
  GATEWAY_PUBLIC_URL: 'http://gateway.invalid',
  WEB_ORIGIN: 'http://localhost:3000',
  LOG_LEVEL: 'silent',
} satisfies NodeJS.ProcessEnv;

export const testConfig = (overrides: Partial<Config> = {}): Config => ({
  ...loadConfig(TEST_ENV),
  ...overrides,
});

/** In-memory Redis stand-in: enough for sessions, caching, and the rate limiter's fallback. */
export function fakeRedis(): Redis {
  const store = new Map<string, string>();
  return autoStub<Redis>('redis', {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, String(value));
      return 'OK';
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
    ping: async () => 'PONG',
    quit: async () => 'OK',
  } as Partial<Redis>);
}

/** A container wired to fakes, for HTTP-level tests that need real controllers and guards. */
export function testContainer(
  options: { gateway?: LlmGateway; prisma?: PrismaClient; config?: Partial<Config> } = {},
): AppContainer {
  return createContainer(testConfig(options.config), pino({ level: 'silent' }), {
    prisma: options.prisma ?? autoStub<PrismaClient>('prisma', {}),
    redis: fakeRedis(),
    gateway: options.gateway ?? fakeGateway(),
  });
}
