import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuditRepository } from '../../src/modules/audit/audit.repository.js';
import { AuditService, scrubMetadata } from '../../src/modules/audit/audit.service.js';
import { ScryptPasswordHasher } from '../../src/modules/auth/password.js';
import { PROVIDER_CATALOG } from '../../src/modules/providers/catalog/index.js';
import { assertSafeBaseUrl, isPrivateAddress } from '../../src/modules/providers/catalog/url-guard.js';
import { autoStub, fakeUnitOfWork, stubRepositories } from '../support/fakes.js';

/** Invariants that must hold no matter how the code around them is refactored. */

const hasher = new ScryptPasswordHasher();

test('a password hash round-trips and rejects near misses', async () => {
  const hash = await hasher.hash('correct horse battery staple');

  assert.match(hash, /^scrypt\$32768\$8\$1\$/);
  assert.ok(!hash.includes('correct'));
  assert.equal(await hasher.verify('correct horse battery staple', hash), true);
  assert.equal(await hasher.verify('Correct horse battery staple', hash), false);
  assert.equal(await hasher.verify('', hash), false);
});

test('every hash uses a fresh salt', async () => {
  assert.notEqual(await hasher.hash('same password'), await hasher.hash('same password'));
});

test('a malformed stored hash never verifies', async () => {
  for (const stored of ['', 'garbage', 'bcrypt$1$2$3$4', 'scrypt$32768$8']) {
    assert.equal(await hasher.verify('anything', stored), false);
  }
});

test('audit metadata is scrubbed of anything secret-shaped', async () => {
  const written: Array<Record<string, unknown>> = [];
  const repos = stubRepositories({
    audit: autoStub<AuditRepository>('audit', {
      append: async (record) => {
        written.push(record as unknown as Record<string, unknown>);
      },
    }),
  });

  await new AuditService(fakeUnitOfWork(repos)).record(
    { organizationId: 'org-1', userId: 'user-1', ip: null },
    {
      action: 'PROVIDER_CREATED',
      targetType: 'provider',
      targetId: 'p-1',
      metadata: {
        name: 'Azure Prod',
        apiKey: 'sk-super-secret',
        credentials: { apiKey: 'sk-nested' },
        access_token: 'tok-123',
        password: 'hunter2',
      },
    },
  );

  const metadata = written[0]?.metadata as Record<string, unknown>;
  assert.equal(metadata.name, 'Azure Prod');
  for (const field of ['apiKey', 'credentials', 'access_token', 'password']) {
    assert.equal(metadata[field], '[redacted]', `${field} must be redacted`);
  }
  assert.ok(!JSON.stringify(metadata).includes('sk-super-secret'));
  assert.ok(!JSON.stringify(metadata).includes('hunter2'));
});

test('scrubbing leaves ordinary fields untouched', () => {
  assert.deepEqual(scrubMetadata({ count: 3, name: 'x' }), { count: 3, name: 'x' });
});

test('internal address ranges are treated as private', () => {
  const private_ = [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ];
  for (const address of private_) assert.equal(isPrivateAddress(address), true, `${address} is private`);
  for (const address of ['8.8.8.8', '1.1.1.1', '104.18.0.1', '2606:4700::1111']) {
    assert.equal(isPrivateAddress(address), false, `${address} is public`);
  }
});

test('a base URL outside the provider allowlist is refused', async () => {
  const suffixes = PROVIDER_CATALOG.AZURE_OPENAI.allowedHostSuffixes;
  const refused = [
    'http://my.openai.azure.com', // not https
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/openai',
    'https://evil.example/openai',
    'https://openai.azure.com.evil.example', // suffix smuggling
    'https://user:pass@my.openai.azure.com',
    'not-a-url',
  ];
  for (const url of refused) {
    await assert.rejects(() => assertSafeBaseUrl(url, suffixes), `${url} must be refused`);
  }
});

test('a legitimate provider host passes the guard', async () => {
  const url = await assertSafeBaseUrl('https://api.openai.com/v1', PROVIDER_CATALOG.OPENAI.allowedHostSuffixes);
  assert.equal(url.hostname, 'api.openai.com');
});

test('no provider puts a credential into model parameters', () => {
  for (const [type, adapter] of Object.entries(PROVIDER_CATALOG)) {
    const params = JSON.stringify(adapter.modelParams('some-model'));
    assert.ok(!/api_?key/i.test(params), `${type} must keep credentials out of model params`);
  }
});

test('provider adapters map models onto the right gateway prefix', () => {
  assert.deepEqual(PROVIDER_CATALOG.AZURE_OPENAI.modelParams('my-deployment'), {
    model: 'azure/my-deployment',
  });
  assert.deepEqual(PROVIDER_CATALOG.OPENAI.modelParams('gpt-4o'), { model: 'openai/gpt-4o' });
  assert.deepEqual(PROVIDER_CATALOG.ANTHROPIC.modelParams('claude-sonnet-4-5'), {
    model: 'anthropic/claude-sonnet-4-5',
  });
});
