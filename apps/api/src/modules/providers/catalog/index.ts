import type { ProviderType } from '@gatehouse/shared';
import { ValidationError } from '../../../core/errors.js';
import type { ProviderAdapter } from './provider-adapter.js';
import { assertSafeBaseUrl, listModels } from './url-guard.js';

/**
 * Adding a provider means adding an entry here. No other file branches on provider type.
 */

const azureOpenAi: ProviderAdapter = {
  displayName: 'Azure OpenAI',
  credentialFields: [{ name: 'apiKey', label: 'API key' }],
  configFields: [
    { name: 'apiBase', label: 'API base URL', required: true, placeholder: 'https://my-resource.openai.azure.com' },
    { name: 'apiVersion', label: 'API version', required: true, placeholder: '2024-10-21' },
  ],
  allowedHostSuffixes: ['openai.azure.com', 'cognitiveservices.azure.com'],

  credentialValues: (credentials, config) => ({
    api_key: credentials.apiKey ?? '',
    api_base: config.apiBase ?? '',
    api_version: config.apiVersion ?? '',
  }),

  // The provider model name is the Azure *deployment* name, not the base model.
  modelParams: (deployment) => ({ model: `azure/${deployment}` }),

  verify: async (credentials, config) => {
    const base = await assertSafeBaseUrl(config.apiBase ?? '', azureOpenAi.allowedHostSuffixes);
    const version = encodeURIComponent(config.apiVersion ?? '');
    return listModels(`${base.origin}/openai/models?api-version=${version}`, {
      'api-key': credentials.apiKey ?? '',
    });
  },
};

const openAi: ProviderAdapter = {
  displayName: 'OpenAI',
  credentialFields: [{ name: 'apiKey', label: 'API key' }],
  configFields: [
    { name: 'apiBase', label: 'API base URL', required: false, placeholder: 'https://api.openai.com/v1' },
  ],
  allowedHostSuffixes: ['api.openai.com'],
  defaultApiBase: 'https://api.openai.com/v1',

  credentialValues: (credentials, config) => ({
    api_key: credentials.apiKey ?? '',
    ...(config.apiBase ? { api_base: config.apiBase } : {}),
  }),

  modelParams: (model) => ({ model: `openai/${model}` }),

  verify: async (credentials, config) => {
    const base = await assertSafeBaseUrl(
      config.apiBase ?? openAi.defaultApiBase ?? '',
      openAi.allowedHostSuffixes,
    );
    return listModels(`${base.origin}/v1/models`, { authorization: `Bearer ${credentials.apiKey ?? ''}` });
  },
};

const anthropic: ProviderAdapter = {
  displayName: 'Anthropic',
  credentialFields: [{ name: 'apiKey', label: 'API key' }],
  configFields: [
    { name: 'apiBase', label: 'API base URL', required: false, placeholder: 'https://api.anthropic.com' },
  ],
  allowedHostSuffixes: ['api.anthropic.com'],
  defaultApiBase: 'https://api.anthropic.com',

  credentialValues: (credentials, config) => ({
    api_key: credentials.apiKey ?? '',
    ...(config.apiBase ? { api_base: config.apiBase } : {}),
  }),

  modelParams: (model) => ({ model: `anthropic/${model}` }),

  verify: async (credentials, config) => {
    const base = await assertSafeBaseUrl(
      config.apiBase ?? anthropic.defaultApiBase ?? '',
      anthropic.allowedHostSuffixes,
    );
    return listModels(`${base.origin}/v1/models`, {
      'x-api-key': credentials.apiKey ?? '',
      'anthropic-version': '2023-06-01',
    });
  },
};

const MOCK_RESPONSE = 'This is a mock response from the Gatehouse development provider.';

/**
 * Development-only. Every model of this provider carries LiteLLM's own `mock_response`, so a
 * request is answered by the gateway itself: no vendor is contacted and no credential is needed,
 * while spend, tokens and request counts are metered exactly as they are for real traffic.
 * LiteLLM prices the mocked tokens from its own table, so `providerModelName` must be a model it
 * knows — "gpt-4o-mini", "claude-3-5-sonnet-20241022" — or the spend comes out zero.
 */
const mock: ProviderAdapter = {
  displayName: 'Mock (development)',
  credentialFields: [],
  configFields: [],
  allowedHostSuffixes: [],

  // LiteLLM wants a key on the deployment even when nothing is called. This is not a credential:
  // it reaches no vendor, and no vendor would accept it.
  credentialValues: () => ({ api_key: 'sk-mock-no-vendor-is-contacted' }),

  modelParams: (model) => ({ model, mock_response: MOCK_RESPONSE }),

  // Nothing is contacted, so nothing can be reported: an empty list is the honest answer.
  verify: async () => [],
};

const catalog = {
  AZURE_OPENAI: azureOpenAi,
  OPENAI: openAi,
  ANTHROPIC: anthropic,
  // MOCK is added by registerMockProvider() only when the flag is on, so an unregistered MOCK
  // fails exactly like any type with no adapter.
} as Record<ProviderType, ProviderAdapter>;

export const PROVIDER_CATALOG: Readonly<Record<ProviderType, ProviderAdapter>> = catalog;

/** Called from the composition root when config.enableMockProvider is set. Nowhere else. */
export function registerMockProvider(): void {
  catalog.MOCK = mock;
}

export function adapterFor(type: ProviderType): ProviderAdapter {
  const adapter = catalog[type] as ProviderAdapter | undefined;
  if (!adapter) throw new ValidationError(`Unknown provider type: ${type}`);
  return adapter;
}

/**
 * Keeps unknown fields out of storage and enforces the adapter's required set. Whitelisting
 * matters most for credentials: an unexpected field would otherwise be persisted verbatim.
 */
export function selectFields(
  allowed: ReadonlyArray<{ name: string; required?: boolean }>,
  input: Record<string, string>,
  allRequired = false,
): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const field of allowed) {
    const value = input[field.name];
    if (value) selected[field.name] = value;
    else if (allRequired || field.required) throw new ValidationError(`Missing required field: ${field.name}`);
  }
  return selected;
}

export type { ProviderAdapter };
