import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext } from '../../src/modules/auth/authenticator.js';
import { AccessService } from '../../src/modules/developers/access.service.js';
import { KeyService } from '../../src/modules/developers/key.service.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import type { AuditRepository, NewAuditRecord } from '../../src/modules/audit/audit.repository.js';
import type { BudgetRepository } from '../../src/modules/developers/budget.repository.js';
import type {
  GatewayKeyReference,
  GatewayKeyRepository,
} from '../../src/modules/developers/gateway-key.repository.js';
import type { ModelAccessRepository } from '../../src/modules/developers/model-access.repository.js';
import type { UserRepository } from '../../src/modules/users/user.repository.js';
import type { UserService } from '../../src/modules/users/user.service.js';
import { autoStub, fakeGateway, fakeUnitOfWork, stubRepositories } from '../support/fakes.js';

const context: AuthContext = { userId: 'user-1', role: 'ADMIN', ip: '10.0.0.1' };

function setup(options: { grants?: Array<{ publicModelName: string; gatewayModelName: string }> } = {}) {
  const grants = (options.grants ?? [{ publicModelName: 'gpt-5', gatewayModelName: 'azure/gpt-5' }]).map(
    (grant) => ({ providerModelId: `pm-${grant.publicModelName}`, ...grant }),
  );

  const stored: GatewayKeyReference[] = [];
  const auditRows: NewAuditRecord[] = [];

  const repos = stubRepositories({
    users: autoStub<UserRepository>('users', {
      findById: async () => ({
        id: 'user-1',
        email: 'dev@acme.test',
        name: 'Dev',
        role: 'MEMBER' as const,
        status: 'ACTIVE' as const,
      }),
    }),
    modelAccess: autoStub<ModelAccessRepository>('modelAccess', { listEffectiveForUser: async () => grants }),
    budgets: autoStub<BudgetRepository>('budgets', {
      findForUser: async () => ({
        id: 'b-1',
        userId: 'user-1',
        teamId: null,
        maxBudget: 50,
        period: 'MONTHLY' as const,
        rpmLimit: 60,
        tpmLimit: null,
      }),
    }),
    keys: autoStub<GatewayKeyRepository>('keys', {
      create: async (input) => {
        const reference: GatewayKeyReference = {
          id: 'key-1',
          userId: input.userId,
          teamId: null,
          keyAlias: input.keyAlias,
          litellmKeyId: input.litellmKeyId,
          keyPrefix: input.keyPrefix,
          status: 'ACTIVE',
          createdAt: new Date('2026-01-01'),
          revokedAt: null,
        };
        stored.push(reference);
        return reference;
      },
    }),
    audit: autoStub<AuditRepository>('audit', {
      append: async (record) => {
        auditRows.push(record);
      },
    }),
  });

  const uow = fakeUnitOfWork(repos);
  const gateway = fakeGateway();
  const users = autoStub<UserService>('users', { ensureGatewayUser: async () => 'gw-user' });

  const access = new AccessService(uow, gateway, users);
  const keys = new KeyService(uow, gateway, access, new AuditService(uow), {
    now: () => new Date('2026-01-02'),
  });

  return { keys, access, gateway, stored, auditRows };
}

test('issuing a key returns the secret but never stores it', async () => {
  const { keys, stored, auditRows } = setup();

  const issued = await keys.issue(context, 'user-1');

  assert.equal(issued.key, 'sk-test-plaintext-value');
  assert.equal(stored.length, 1);
  assert.ok(!JSON.stringify(stored).includes(issued.key), 'plaintext key must not reach the database');
  assert.equal(stored[0]?.keyPrefix, 'sk-tes…alue');
  assert.ok(!JSON.stringify(auditRows).includes(issued.key), 'plaintext key must not reach the audit log');
  assert.equal(auditRows[0]?.action, 'API_KEY_CREATED');
});

test('a key carries both the namespaced and the public model name', async () => {
  const { access } = setup({
    grants: [
      { publicModelName: 'gpt-5', gatewayModelName: 'azure/gpt-5' },
      { publicModelName: 'claude-sonnet', gatewayModelName: 'anthropic/claude-sonnet' },
    ],
  });

  const spec = await access.buildKeySpec('user-1', 'dev--1234');

  // The gateway checks the requested model before resolving aliases, so both names are allowed
  // and the alias performs the routing.
  assert.deepEqual(spec.models.sort(), ['anthropic/claude-sonnet', 'azure/gpt-5']);
  assert.deepEqual(spec.aliases, {
    'gpt-5': 'azure/gpt-5',
    'claude-sonnet': 'anthropic/claude-sonnet',
  });
});

test("the developer's budget is set on the gateway user, not on the key", async () => {
  const { access, gateway } = setup();

  await access.buildKeySpec('user-1', 'alias');

  const budgetCall = gateway.calls.find((call) => call.method === 'setUserBudget');
  assert.ok(budgetCall, 'the ceiling must be pushed to the mirrored gateway user');
  assert.deepEqual(budgetCall.args, [
    'gw-user',
    { maxBudget: 50, budgetDuration: '30d', rpmLimit: 60, tpmLimit: undefined },
  ]);
});

test('every key a developer holds draws on one shared allowance', async () => {
  const { keys, gateway } = setup();

  // Two keys for the same developer. If either carried a budget of its own, the developer's
  // ceiling would be multiplied by the number of keys they happen to hold.
  await keys.issue(context, 'user-1');
  await keys.issue(context, 'user-1');

  const specs = gateway.calls.filter((call) => call.method === 'issueKey').map((call) => call.args[0]);
  assert.equal(specs.length, 2);
  for (const spec of specs) {
    assert.deepEqual(
      Object.keys(spec as object).sort(),
      ['aliases', 'alias', 'gatewayUserId', 'models'].sort(),
      'a key spec must carry no budget of its own',
    );
  }
});

test('a developer with no grants gets a key that can call nothing', async () => {
  const { access } = setup({ grants: [] });
  const spec = await access.buildKeySpec('user-1', 'alias');

  assert.deepEqual(spec.models, []);
  assert.deepEqual(spec.aliases, {});
});

test('key aliases are unique per issue, since revocation depends on them', async () => {
  const { keys, stored } = setup();
  await keys.issue(context, 'user-1');
  await keys.issue(context, 'user-1');

  assert.notEqual(stored[0]?.keyAlias, stored[1]?.keyAlias);
  for (const reference of stored) assert.match(reference.keyAlias, /^dev--[0-9a-f]{8}$/);
});
