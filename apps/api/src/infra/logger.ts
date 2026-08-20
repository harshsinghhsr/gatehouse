import { pino } from 'pino';
import type { Logger as PinoLogger } from 'pino';
import type { Config } from '../core/config.js';
import type { Logger } from '../core/ports.js';

/**
 * Redaction is defined once, here. Add paths as new shapes appear; never remove one.
 * LLM prompts are never logged at all — request bodies are not logged by default.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.api_key',
  '*.apiKey',
  '*.password',
  '*.passwordHash',
  '*.secret',
  '*.credentials',
  '*.credential_values',
  '*.master_key',
  '*.masterKey',
  '*.token',
  '*.key',
];

export function createLogger(config: Pick<Config, 'logLevel'>): PinoLogger {
  return pino({ level: config.logLevel, redact: { paths: REDACTED_PATHS, censor: '[redacted]' } });
}

/** pino already satisfies the Logger port; this makes the dependency explicit. */
export const asLogger = (logger: PinoLogger): Logger => logger;
