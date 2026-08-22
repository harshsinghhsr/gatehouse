import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictError } from '../../src/core/errors.js';
import { onUniqueConflict } from '../../src/infra/db/conflicts.js';

/**
 * A pre-check in a service loses the race against a concurrent insert, so the database is what
 * actually enforces uniqueness — and its P2002 must never escape the repository layer as a 500.
 */

const p2002 = (target: unknown) =>
  Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } });

/** What Prisma 7 actually throws through the pg driver adapter. */
const p2002ViaAdapter = (fields: string[]) =>
  Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { modelName: 'User', driverAdapterError: { cause: { constraint: { fields } } } },
  });

test('a unique violation becomes a conflict naming the column that collided', async () => {
  await assert.rejects(
    () => onUniqueConflict({ email: 'A user with this email already exists' }, () => Promise.reject(p2002(['email']))),
    (error: unknown) => {
      assert.ok(error instanceof ConflictError);
      assert.equal(error.status, 409);
      assert.equal(error.message, 'A user with this email already exists');
      return true;
    },
  );
});

test('the driver adapter shape is matched back to its column', async () => {
  await assert.rejects(
    () =>
      onUniqueConflict({ email: 'A user with this email already exists' }, () =>
        Promise.reject(p2002ViaAdapter(['email'])),
      ),
    (error: unknown) => {
      assert.ok(error instanceof ConflictError);
      assert.equal(error.message, 'A user with this email already exists');
      return true;
    },
  );
});

test('an index name is split back into the column it protects', async () => {
  await assert.rejects(
    () => onUniqueConflict({ slug: 'taken' }, () => Promise.reject(p2002('Team_slug_key'))),
    (error: unknown) => {
      assert.ok(error instanceof ConflictError);
      assert.equal(error.message, 'taken');
      return true;
    },
  );
});

test('an unlabelled column still conflicts rather than leaking a 500', async () => {
  await assert.rejects(
    () => onUniqueConflict({ email: 'taken' }, () => Promise.reject(p2002(['litellmUserId']))),
    ConflictError,
  );
});

test('any other failure passes through untouched', async () => {
  const boom = new Error('connection reset');
  await assert.rejects(() => onUniqueConflict({ email: 'taken' }, () => Promise.reject(boom)), (error) => error === boom);
});

test('a successful write is returned unchanged', async () => {
  assert.equal(await onUniqueConflict({}, async () => 'ok'), 'ok');
});
