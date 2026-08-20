import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../../src/http/server.js';
import { testContainer } from '../support/fakes.js';

/** The HTTP contract: guards, error shape, and the cross-origin rule. */

test('liveness answers even when every dependency is down', async () => {
  const container = testContainer();
  container.healthChecks.database = () => Promise.reject(new Error('down'));

  const app = await buildServer(container);
  const response = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
  await app.close();
});

test('readiness is 503 and names the failing dependency', async () => {
  const container = testContainer();
  container.healthChecks = {
    database: async () => 1,
    gateway: async () => {
      throw new Error('connection refused');
    },
  };

  const app = await buildServer(container);
  const response = await app.inject({ method: 'GET', url: '/ready' });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    status: 'degraded',
    services: { database: 'ok', gateway: 'down' },
  });
  await app.close();
});

test('every organization-scoped route requires a session', async () => {
  const app = await buildServer(testContainer());

  for (const url of [
    '/api/me',
    '/api/organizations',
    '/api/providers',
    '/api/models',
    '/api/developers',
    '/api/teams',
    '/api/usage',
    '/api/budgets',
    '/api/connect',
    '/api/audit-logs',
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 401, `${url} must require authentication`);
    assert.equal(response.json().error.code, 'unauthenticated');
  }
  await app.close();
});

test('a mutation from another origin is refused', async () => {
  const app = await buildServer(testContainer());

  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: 'https://evil.example' },
    payload: { email: 'someone@example.test', password: 'irrelevant' },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, 'cross_origin');
  await app.close();
});

test('a validation failure is a 400 that names the field', async () => {
  const app = await buildServer(testContainer());

  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'not-an-email', password: 'x' },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'invalid_request');
  assert.match(response.json().error.message, /email/);
  await app.close();
});

test('an unexpected failure never leaks internals', async () => {
  const container = testContainer();
  const app = await buildServer(container);
  app.get('/boom', async () => {
    throw new Error('connection string postgres://user:pw@host');
  });

  const response = await app.inject({ method: 'GET', url: '/boom' });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json().error.message, 'Internal server error');
  assert.ok(response.json().error.requestId);
  assert.ok(!response.payload.includes('postgres://'));
  await app.close();
});

test('an unknown route returns the standard error shape', async () => {
  const app = await buildServer(testContainer());
  const response = await app.inject({ method: 'GET', url: '/api/nope' });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'not_found');
  await app.close();
});
