import { fileURLToPath } from 'node:url';

/**
 * Integration tests run on the host against the compose stack, so they need the same credentials
 * the containers were started with — and ./scripts/setup-env.sh generates those, so they cannot
 * be hardcoded here. Importing this module loads the repository .env; real environment variables
 * still win, which is what lets CI or a developer override any single value.
 */
try {
  process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
} catch {
  // No .env — the compose defaults below apply.
}

const CONTAINER_HOSTS = ['postgres', 'redis', 'litellm', 'localstack'];

/** .env describes the container network. From the host, every service is published on localhost. */
export function hostUrl(url: string): string {
  return CONTAINER_HOSTS.reduce(
    (result, host) => result.replaceAll(`@${host}:`, '@localhost:').replaceAll(`//${host}:`, '//localhost:'),
    url,
  );
}
