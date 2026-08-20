import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { describe } from 'node:test';
import type { SecretStore } from '../../src/core/ports.js';
import { AwsSecretStore, FileSecretStore, secretReference } from '../../src/infra/secrets/secret-store.js';
import { hostUrl } from '../support/stack-env.js';

/**
 * One contract, two implementations. The file store runs everywhere; the AWS store runs against
 * LocalStack when it is up, so the production code path is exercised for real rather than mocked.
 *
 *   docker compose --profile aws up -d localstack
 *   INTEGRATION=1 npm run -w apps/api test
 */

const LOCALSTACK_URL = hostUrl(process.env.AWS_ENDPOINT_URL || 'http://localhost:4566');

// LocalStack accepts any credentials, but the SDK still insists on resolving some. In production
// these are absent and the task role supplies them instead.
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';
process.env.AWS_REGION ||= 'us-east-1';

async function localstackIsUp(): Promise<boolean> {
  if (process.env.INTEGRATION !== '1') return false;
  try {
    const response = await fetch(`${LOCALSTACK_URL}/_localstack/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return false;
    const health = (await response.json()) as { services?: Record<string, string> };
    return health.services?.secretsmanager === 'available' || health.services?.secretsmanager === 'running';
  } catch {
    return false;
  }
}

/** The behaviour every secret store must exhibit, whichever backend is configured. */
function contractTests(name: string, create: () => SecretStore, skip: boolean | string) {
  describe(`${name} secret store`, { skip }, () => {
    const reference = () => secretReference('test', `org-${Date.now()}-${Math.random()}`, 'provider-1');

    test('stores and returns a credential unchanged', async () => {
      const store = create();
      const key = reference();

      const returned = await store.put(key, { apiKey: 'sk-provider-secret', apiBase: 'https://x.test' });
      assert.ok(returned.length > 0, 'put must return a reference we can persist');

      assert.deepEqual(await store.get(key), {
        apiKey: 'sk-provider-secret',
        apiBase: 'https://x.test',
      });
      await store.delete(key);
    });

    test('overwrites an existing secret rather than failing', async () => {
      const store = create();
      const key = reference();

      await store.put(key, { apiKey: 'first' });
      await store.put(key, { apiKey: 'second' });

      assert.deepEqual(await store.get(key), { apiKey: 'second' });
      await store.delete(key);
    });

    test('a deleted secret is gone', async () => {
      const store = create();
      const key = reference();

      await store.put(key, { apiKey: 'temporary' });
      await store.delete(key);

      await assert.rejects(() => store.get(key));
    });

    test('reading an unknown reference rejects', async () => {
      await assert.rejects(() => create().get(reference()));
    });
  });
}

contractTests('file', () => new FileSecretStore(join(mkdtempSync(join(tmpdir(), 'secrets-')), 'store.json')), false);

const localstackDown = !(await localstackIsUp());
contractTests(
  'AWS (LocalStack)',
  () => new AwsSecretStore({ endpoint: LOCALSTACK_URL, region: 'us-east-1' }),
  localstackDown && 'LocalStack is not running (docker compose --profile aws up -d localstack)',
);
