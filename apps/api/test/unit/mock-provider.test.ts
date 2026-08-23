import assert from 'node:assert/strict';
import test from 'node:test';
import { PROVIDER_CATALOG, adapterFor, registerMockProvider } from '../../src/modules/providers/catalog/index.js';

/**
 * The development-only provider must be absent until the composition root asks for it, and
 * indistinguishable from an unknown type while it is.
 */

test('MOCK is not in the catalogue until it is registered', () => {
  assert.equal(Object.keys(PROVIDER_CATALOG).includes('MOCK'), false);
  assert.throws(() => adapterFor('MOCK'), /Unknown provider type: MOCK/);

  registerMockProvider();

  assert.equal(Object.keys(PROVIDER_CATALOG).includes('MOCK'), true);
  assert.equal(adapterFor('MOCK').displayName, 'Mock (development)');
});

test('a mock model is mocked at the gateway and needs no vendor', () => {
  registerMockProvider();
  const adapter = adapterFor('MOCK');

  // The underlying model name is passed through unprefixed: LiteLLM prices the mocked tokens
  // from its own table, which only works for a model it knows.
  const params = adapter.modelParams('gpt-4o-mini') as { model: string; mock_response: string };
  assert.equal(params.model, 'gpt-4o-mini');
  assert.ok(params.mock_response.length > 0, 'mock_response is what keeps the request inside LiteLLM');

  assert.deepEqual(adapter.credentialFields, [], 'no key is asked for, because none is used');
});

test('verifying a mock provider contacts nobody and claims nothing', async () => {
  registerMockProvider();
  assert.deepEqual(await adapterFor('MOCK').verify({}, {}), []);
});
