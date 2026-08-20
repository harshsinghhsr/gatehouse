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

export const PROVIDER_CATALOG: Readonly<Record<ProviderType, ProviderAdapter>> = Object.freeze({
  AZURE_OPENAI: azureOpenAi,
  OPENAI: openAi,
  ANTHROPIC: anthropic,
});

export function adapterFor(type: ProviderType): ProviderAdapter {
  return PROVIDER_CATALOG[type];
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
