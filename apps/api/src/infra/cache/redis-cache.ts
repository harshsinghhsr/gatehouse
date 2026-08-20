import { Redis } from 'ioredis';
import type { CacheStore } from '../../core/ports.js';

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 2 });
}

/**
 * Cache failures must never fail a request: a miss is always a valid answer, so read errors
 * degrade to "not cached" rather than propagating.
 */
export class RedisCacheStore implements CacheStore {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key).catch(() => null);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, 'EX', ttlSeconds).catch(() => undefined);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key).catch(() => undefined);
  }
}
