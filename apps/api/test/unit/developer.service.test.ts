import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../../src/core/errors.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import type { AuditRepository } from '../../src/modules/audit/audit.repository.js';
import type { AuthContext } from '../../src/modules/auth/authenticator.js';
import type { PasswordHasher } from '../../src/modules/auth/password.js';
import type { AccessService } from '../../src/modules/developers/access.service.js';
import { DeveloperService } from '../../src/modules/developers/developer.service.js';
import type { KeyService } from '../../src/modules/developers/key.service.js';
import type { User, UserRepository } from '../../src/modules/users/user.repository.js';
import { autoStub, fakeGateway, fakeUnitOfWork, stubRepositories } from '../support/fakes.js';

/** An instance with no active owner can never grant the role back, so the last one is protected. */

const context: AuthContext = { userId: 'admin-1', role: 'OWNER', ip: null };

const owner: User = {
  id: 'owner-1',
  email: 'owner@acme.test',
  name: 'Owner',
  role: 'OWNER',
  status: 'ACTIVE',
};

function setup(users: User[]) {
  const deleted: string[] = [];
  const statuses: Array<{ id: string; status: string }> = [];

  const repos = stubRepositories({
    users: autoStub<UserRepository>('users', {
      findById: async (id) => users.find((user) => user.id === id) ?? null,
      list: async () => users,
      delete: async (id) => {
        deleted.push(id);
      },
      setStatus: async (id, status) => {
        statuses.push({ id, status });
      },
    }),
    audit: autoStub<AuditRepository>('audit', { append: async () => undefined }),
  });

  const uow = fakeUnitOfWork(repos);
  const developers = new DeveloperService(
    uow,
    fakeGateway(),
    autoStub<AccessService>('access', { requireUser: async (id) => users.find((u) => u.id === id) as User }),
    autoStub<KeyService>('keys', { revokeAllForUser: async () => 0 }),
    autoStub<PasswordHasher>('hasher', {}),
    new AuditService(uow),
  );

  return { developers, deleted, statuses };
}

test('the last active owner cannot be deleted', async () => {
  const { developers, deleted } = setup([
    owner,
    { id: 'dev-1', email: 'dev@acme.test', name: 'Dev', role: 'MEMBER', status: 'ACTIVE' },
  ]);

  await assert.rejects(() => developers.remove(context, owner.id), ValidationError);
  assert.deepEqual(deleted, [], 'the owner row must survive the refused delete');
});

test('the last active owner cannot be disabled', async () => {
  const { developers, statuses } = setup([owner]);

  await assert.rejects(() => developers.update(context, owner.id, { status: 'DISABLED' }), ValidationError);
  assert.deepEqual(statuses, [], 'the owner must stay enabled');
});

test('the last active owner cannot be demoted', async () => {
  const { developers } = setup([owner]);

  await assert.rejects(() => developers.update(context, owner.id, { role: 'ADMIN' }), ValidationError);
});

test('an owner is removable once a second active owner exists', async () => {
  const { developers, deleted } = setup([
    owner,
    { id: 'owner-2', email: 'second@acme.test', name: 'Second', role: 'OWNER', status: 'ACTIVE' },
  ]);

  await developers.remove(context, owner.id);
  assert.deepEqual(deleted, [owner.id]);
});

test('a disabled second owner does not count as cover', async () => {
  const { developers } = setup([
    owner,
    { id: 'owner-2', email: 'second@acme.test', name: 'Second', role: 'OWNER', status: 'DISABLED' },
  ]);

  await assert.rejects(() => developers.remove(context, owner.id), ValidationError);
});
