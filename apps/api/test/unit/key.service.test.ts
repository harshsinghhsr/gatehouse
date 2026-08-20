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
import type { MembershipRepository } from '../../src/modules/organizations/membership.repository.js';
import type { OrganizationRepository } from '../../src/modules/organizations/organization.repository.js';
import type { OrganizationService } from '../../src/modules/organizations/organization.service.js';
import { autoStub, fakeGateway, fakeUnitOfWork, stubRepositories } from '../support/fakes.js';

const context: AuthContext = { userId: 'user-1', organizationId: 'org-1', role: 'ADMIN', ip: '10.0.0.1' };

function setup(options: { grants?: Array<{ publicModelName: string; gatewayModelName: string }> } = {}) {
  const grants = (options.grants ?? [{ publicModelName: 'gpt-5', gatewayModelName: 'acme/gpt-5' }]).map(
    (grant) => ({ providerModelId: `pm-${grant.publicModelName}`, ...grant }),
  );

  const stored: GatewayKeyReference[] = [];
  const auditRows: NewAuditRecord[] = [];

  const repos = stubRepositories({
    organizations: autoStub<OrganizationRepository>('organizations', {
      findById: async () => ({ id: 'org-1', name: 'Acme', slug: 'acme', litellmOrgId: 'gw-org' }),
    }),
    memberships: autoStub<MembershipRepository>('memberships', {
      findWithUser: async () => ({
        id: 'm-1',
        organizationId: 'org-1',
        userId: 'user-1',
        role: 'MEMBER' as const,
        litellmUserId: 'gw-user',
        user: { id: 'user-1', email: 'dev@acme.test', name: 'Dev', status: 'ACTIVE' as const },
      }),
    }),
    modelAccess: autoStub<ModelAccessRepository>('modelAccess', { listEffectiveForUser: async () => grants }),
    budgets: autoStub<BudgetRepository>('budgets', {
      findForUser: async () => ({
        id: 'b-1',
        organizationId: 'org-1',
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
          organizationId: input.organizationId,
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
  const organizations = autoStub<OrganizationService>('organizations', {
    ensureGatewayUser: async () => 'gw-user',
  });

  const access = new AccessService(uow, gateway, organizations);
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
      { publicModelName: 'gpt-5', gatewayModelName: 'acme/gpt-5' },
      { publicModelName: 'claude-sonnet', gatewayModelName: 'acme/claude-sonnet' },
    ],
  });

  const spec = await access.buildKeySpec('org-1', 'user-1', 'acme--dev--1234');

  // The gateway checks the requested model before resolving aliases, so both names are allowed
  // and the alias performs the routing.
  assert.deepEqual(spec.models.sort(), ['acme/claude-sonnet', 'acme/gpt-5']);
  assert.deepEqual(spec.aliases, {
    'gpt-5': 'acme/gpt-5',
    'claude-sonnet': 'acme/claude-sonnet',
  });
});

test('the budget on the developer becomes the budget on the key', async () => {
  const { access } = setup();
  const spec = await access.buildKeySpec('org-1', 'user-1', 'alias');

  assert.equal(spec.maxBudget, 50);
  assert.equal(spec.budgetDuration, '30d');
  assert.equal(spec.rpmLimit, 60);
});

test('a developer with no grants gets a key that can call nothing', async () => {
  const { access } = setup({ grants: [] });
  const spec = await access.buildKeySpec('org-1', 'user-1', 'alias');

  assert.deepEqual(spec.models, []);
  assert.deepEqual(spec.aliases, {});
});

test('key aliases are unique per issue, since revocation depends on them', async () => {
  const { keys, stored } = setup();
  await keys.issue(context, 'user-1');
  await keys.issue(context, 'user-1');

  assert.notEqual(stored[0]?.keyAlias, stored[1]?.keyAlias);
  for (const reference of stored) assert.match(reference.keyAlias, /^acme--dev--[0-9a-f]{8}$/);
});
