import { z } from 'zod';

/**
 * Configuration is parsed once, at the edge of the process, and passed down explicitly.
 * Nothing below this file reads process.env — a service that needs a value receives it.
 */
const configSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  port: z.coerce.number().int().positive().default(3001),
  logLevel: z.string().default('info'),

  databaseUrl: z.string().min(1),
  redisUrl: z.string().min(1),

  litellmBaseUrl: z.string().url(),
  litellmMasterKey: z.string().min(1),

  /** Where developers point their SDKs. Public, unlike litellmBaseUrl which may be internal. */
  gatewayPublicUrl: z.string().url(),
  webOrigin: z.string().url(),

  secretsBackend: z.enum(['file', 'aws']).default('file'),
  /** Set to a LocalStack endpoint in development; unset in production, where the real AWS is used. */
  awsEndpointUrl: z.string().url().optional(),
  awsRegion: z.string().default('us-east-1'),
  secretsFile: z.string().default('/tmp/gatehouse-secrets.json'),
  deployEnv: z.string().default('dev'),

  /** Sign-up closes after the first account unless this is explicitly reopened. */
  /**
   * How many reverse proxies sit in front of this process. Behind the bundled nginx that is 1.
   * It matters because rate limits key on the client address: trust too few hops and everyone
   * shares one bucket, trust too many and a client can forge X-Forwarded-For to get a fresh one.
   * A CIDR or comma-separated list of trusted proxy addresses also works.
   */
  trustProxy: z
    .string()
    .default('false')
    .transform((value): boolean | number | string => {
      if (value === 'false' || value === '') return false;
      if (value === 'true') return true;
      return /^\d+$/.test(value) ? Number(value) : value;
    }),

  allowSignup: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  sessionTtlSeconds: z.coerce.number().int().positive().default(60 * 60 * 24 * 7),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(
    withoutBlanks({
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      logLevel: env.LOG_LEVEL,
      databaseUrl: env.DATABASE_URL,
      redisUrl: env.REDIS_URL,
      litellmBaseUrl: env.LITELLM_BASE_URL,
      litellmMasterKey: env.LITELLM_MASTER_KEY,
      gatewayPublicUrl: env.GATEWAY_PUBLIC_URL || env.LITELLM_BASE_URL,
      webOrigin: env.WEB_ORIGIN,
      secretsBackend: env.SECRETS_BACKEND,
      awsEndpointUrl: env.AWS_ENDPOINT_URL,
      awsRegion: env.AWS_REGION,
      secretsFile: env.SECRETS_FILE,
      deployEnv: env.DEPLOY_ENV,
      trustProxy: env.TRUST_PROXY,
      allowSignup: env.ALLOW_SIGNUP,
      sessionTtlSeconds: env.SESSION_TTL_SECONDS,
    }),
  );

  if (!result.success) {
    // Fail loudly at boot rather than at the first request that needs the missing value, and
    // name the variable the operator actually sets — `SECRETS_BACKEND`, not `secretsBackend`.
    const problems = result.error.issues
      .map((issue) => `  ${envNameOf(String(issue.path[0]))}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  assertProductionReady(result.data);
  return result.data;
}

/** Every schema key is the camelCase form of its variable, so the mapping is mechanical. */
function envNameOf(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
}

/**
 * Docker Compose passes an unset variable through as an empty string, and an empty string is not
 * the same as absent: `.optional()` rejects it and `.default()` never fires. Dropping the blanks
 * first is what lets `AWS_ENDPOINT_URL=` in .env mean "not configured".
 */
function withoutBlanks(input: Record<string, string | undefined>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ''));
}

/**
 * A fork that reaches production still carrying the values from .env.example is the most likely
 * way this platform gets compromised, so boot fails loudly instead of serving a known master key.
 */
function assertProductionReady(config: Config): void {
  if (config.nodeEnv !== 'production') return;

  const placeholder = /change-me|dev-only|^sk-dev-/i;
  if (placeholder.test(config.litellmMasterKey) || config.litellmMasterKey.length < 24) {
    throw new Error(
      'LITELLM_MASTER_KEY is a development placeholder. Run ./scripts/setup-env.sh to generate real secrets.',
    );
  }

  // The session cookie is Secure in production, so a plaintext origin means every login silently
  // fails. Better to say so at boot than to debug an empty dashboard.
  if (config.webOrigin.startsWith('http://')) {
    throw new Error('WEB_ORIGIN must be an https URL in production: the session cookie is Secure.');
  }
}
