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

/**
 * .env describes the container network. From the host, every service is published on localhost.
 *
 * Parsed rather than string-replaced: 'postgres' is both a container name and the database
 * username, so rewriting text turned postgresql://postgres:pw@postgres:5432 into
 * postgresql://localhost:pw@localhost:5432 and authentication failed against a user named
 * "localhost".
 */
export function hostUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (CONTAINER_HOSTS.includes(parsed.hostname)) parsed.hostname = 'localhost';
    // URL.toString() adds a trailing slash to a bare origin; callers append paths that start
    // with one, and http://localhost:4000//v1 is a different route to the gateway.
    return parsed.pathname === '/' ? parsed.toString().replace(/\/$/, '') : parsed.toString();
  } catch {
    return url;
  }
}
