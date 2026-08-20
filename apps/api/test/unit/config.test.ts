import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { loadConfig } from '../../src/core/config.js';

/** A minimal environment that boots in development. */
const base = {
  DATABASE_URL: 'postgresql://postgres:postgres@postgres:5432/gateway',
  REDIS_URL: 'redis://redis:6379',
  LITELLM_BASE_URL: 'http://litellm:4000',
  LITELLM_MASTER_KEY: 'sk-dev-master-key-change-me',
  WEB_ORIGIN: 'http://localhost:3000',
} as NodeJS.ProcessEnv;

describe('configuration', () => {
  test('development boots with the values from .env.example', () => {
    const config = loadConfig(base);
    assert.equal(config.nodeEnv, 'development');
    assert.equal(config.secretsBackend, 'file');
  });

  test('a blank variable means unset, not an empty value', () => {
    // Docker Compose expands an unset variable to '', which used to kill the API at boot.
    const config = loadConfig({
      ...base,
      AWS_ENDPOINT_URL: '',
      GATEWAY_PUBLIC_URL: '',
      LOG_LEVEL: '',
      SECRETS_BACKEND: '',
    });
    assert.equal(config.awsEndpointUrl, undefined);
    assert.equal(config.gatewayPublicUrl, base.LITELLM_BASE_URL, 'falls back rather than staying blank');
    assert.equal(config.logLevel, 'info', 'the default applies');
    assert.equal(config.secretsBackend, 'file');
  });

  test('production refuses a placeholder master key', () => {
    assert.throws(
      () => loadConfig({ ...base, NODE_ENV: 'production', WEB_ORIGIN: 'https://gateway.example.com' }),
      /LITELLM_MASTER_KEY is a development placeholder/,
    );
  });

  test('production refuses a short master key', () => {
    assert.throws(
      () =>
        loadConfig({
          ...base,
          NODE_ENV: 'production',
          WEB_ORIGIN: 'https://gateway.example.com',
          LITELLM_MASTER_KEY: 'sk-too-short',
        }),
      /LITELLM_MASTER_KEY/,
    );
  });

  test('production refuses a plaintext origin, because the session cookie is Secure', () => {
    assert.throws(
      () =>
        loadConfig({
          ...base,
          NODE_ENV: 'production',
          LITELLM_MASTER_KEY: `sk-${'a'.repeat(48)}`,
        }),
      /WEB_ORIGIN must be an https URL/,
    );
  });

  test('production boots once the secrets are real', () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://gateway.example.com',
      LITELLM_MASTER_KEY: `sk-${'a'.repeat(48)}`,
    });
    assert.equal(config.nodeEnv, 'production');
  });

  test('TRUST_PROXY is a hop count, a flag, or a proxy address', () => {
    assert.equal(loadConfig(base).trustProxy, false, 'directly exposed by default');
    assert.equal(loadConfig({ ...base, TRUST_PROXY: '1' }).trustProxy, 1);
    assert.equal(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy, true);
    assert.equal(loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8' }).trustProxy, '10.0.0.0/8');
  });
});
