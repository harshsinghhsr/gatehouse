/**
 * Ports: what the domain needs from the outside world, expressed without naming a vendor.
 * Adapters live under src/infra. Services depend on these interfaces only, which is what
 * makes them unit-testable with in-memory fakes.
 */

export interface Logger {
  debug(payload: Record<string, unknown>, message: string): void;
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Key-value cache with expiry. Used for read-through caching, never as a source of truth. */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Provider credentials. Postgres stores only the reference this returns; the values live
 * in AWS Secrets Manager in production.
 */
export interface SecretStore {
  put(reference: string, values: Record<string, string>): Promise<string>;
  get(reference: string): Promise<Record<string, string>>;
  delete(reference: string): Promise<void>;
}
