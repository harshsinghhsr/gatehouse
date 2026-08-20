import type { UserStatus } from '@gatehouse/shared';
import type { Db } from '../../infra/db/client.js';

export type User = {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
};

/** Only the authentication service ever asks for the hash. */
export type UserWithSecret = User & { passwordHash: string | null };

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmailWithSecret(email: string): Promise<UserWithSecret | null>;
  countAll(): Promise<number>;
  create(input: { email: string; name: string; passwordHash: string | null }): Promise<User>;
  findOrCreateByEmail(input: { email: string; name: string; passwordHash: string | null }): Promise<User>;
  setStatus(id: string, status: UserStatus): Promise<void>;
}

const SELECT = { id: true, email: true, name: true, status: true } as const;

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  findById(id: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { id }, select: SELECT });
  }

  findByEmailWithSecret(email: string): Promise<UserWithSecret | null> {
    return this.db.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { ...SELECT, passwordHash: true },
    });
  }

  countAll(): Promise<number> {
    return this.db.user.count();
  }

  create(input: { email: string; name: string; passwordHash: string | null }): Promise<User> {
    return this.db.user.create({
      data: { ...input, email: input.email.toLowerCase() },
      select: SELECT,
    });
  }

  findOrCreateByEmail(input: { email: string; name: string; passwordHash: string | null }): Promise<User> {
    const email = input.email.toLowerCase();
    return this.db.user.upsert({
      where: { email },
      update: {},
      create: { ...input, email },
      select: SELECT,
    });
  }

  async setStatus(id: string, status: UserStatus): Promise<void> {
    await this.db.user.update({ where: { id }, data: { status } });
  }
}
