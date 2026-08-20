import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

/** What a signed-in caller is: an identity plus the one organization they are acting in. */
export type Session = {
  userId: string;
  organizationId: string;
};

export interface SessionStore {
  create(session: Session): Promise<string>;
  read(id: string): Promise<Session | null>;
  destroy(id: string): Promise<void>;
}

const PREFIX = 'sess:';

export class RedisSessionStore implements SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  /** 256 bits of entropy, url-safe. Server-side storage means logout is a real revocation. */
  async create(session: Session): Promise<string> {
    const id = randomBytes(32).toString('base64url');
    await this.redis.set(PREFIX + id, JSON.stringify(session), 'EX', this.ttlSeconds);
    return id;
  }

  async read(id: string): Promise<Session | null> {
    const raw = await this.redis.get(PREFIX + id);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Session;
    } catch {
      return null;
    }
  }

  async destroy(id: string): Promise<void> {
    await this.redis.del(PREFIX + id);
  }
}
