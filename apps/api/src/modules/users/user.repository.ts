import type { Role, UserStatus } from '@gatehouse/shared';
import type { Db } from '../../infra/db/client.js';

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
};

/** Only the authentication service ever asks for the hash. */
export type UserWithSecret = User & { passwordHash: string | null };

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmailWithSecret(email: string): Promise<UserWithSecret | null>;
  countAll(): Promise<number>;
  emailExists(email: string): Promise<boolean>;
  list(): Promise<User[]>;
  create(input: { email: string; name: string; passwordHash: string | null; role: Role }): Promise<User>;
  setStatus(id: string, status: UserStatus): Promise<void>;
  setRole(id: string, role: Role): Promise<void>;
  delete(id: string): Promise<void>;
  /** The mirrored LiteLLM user, or null until one is created. */
  findLitellmUserId(id: string): Promise<string | null>;
  setLitellmUserId(id: string, litellmUserId: string): Promise<void>;
  /** Users that already exist in LiteLLM, i.e. those that can have usage attributed. */
  listMirrored(): Promise<Array<{ id: string; litellmUserId: string }>>;
}

const SELECT = { id: true, email: true, name: true, role: true, status: true } as const;

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

  async emailExists(email: string): Promise<boolean> {
    return (await this.db.user.count({ where: { email: email.toLowerCase() } })) > 0;
  }

  list(): Promise<User[]> {
    return this.db.user.findMany({ select: SELECT, orderBy: { createdAt: 'asc' } });
  }

  create(input: { email: string; name: string; passwordHash: string | null; role: Role }): Promise<User> {
    return this.db.user.create({
      data: { ...input, email: input.email.toLowerCase() },
      select: SELECT,
    });
  }

  async setStatus(id: string, status: UserStatus): Promise<void> {
    await this.db.user.update({ where: { id }, data: { status } });
  }

  async setRole(id: string, role: Role): Promise<void> {
    await this.db.user.update({ where: { id }, data: { role } });
  }

  async delete(id: string): Promise<void> {
    await this.db.user.delete({ where: { id } });
  }

  async findLitellmUserId(id: string): Promise<string | null> {
    const row = await this.db.user.findUnique({ where: { id }, select: { litellmUserId: true } });
    return row?.litellmUserId ?? null;
  }

  async setLitellmUserId(id: string, litellmUserId: string): Promise<void> {
    await this.db.user.update({ where: { id }, data: { litellmUserId } });
  }

  async listMirrored(): Promise<Array<{ id: string; litellmUserId: string }>> {
    const rows = await this.db.user.findMany({
      where: { litellmUserId: { not: null } },
      select: { id: true, litellmUserId: true },
    });
    return rows.map((row) => ({ id: row.id, litellmUserId: row.litellmUserId as string }));
  }
}
