import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { hostUrl } from '../support/stack-env.js';

describe('hostUrl', () => {
  test('rewrites a container hostname without touching the credentials', () => {
    // 'postgres' is the username *and* the container name; only the host may change.
    assert.equal(
      hostUrl('postgresql://postgres:secret@postgres:5432/gateway'),
      'postgresql://postgres:secret@localhost:5432/gateway',
    );
  });

  test('rewrites the other service hostnames', () => {
    assert.equal(hostUrl('http://litellm:4000'), 'http://localhost:4000', 'no trailing slash to double up');
    assert.equal(hostUrl('http://localstack:4566'), 'http://localhost:4566');
    assert.equal(hostUrl('redis://redis:6379'), 'redis://localhost:6379');
  });

  test('leaves anything already host-facing alone', () => {
    assert.equal(hostUrl('postgresql://user:pw@localhost:5432/db'), 'postgresql://user:pw@localhost:5432/db');
    assert.equal(hostUrl('not-a-url'), 'not-a-url');
  });
});
