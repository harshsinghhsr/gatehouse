import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Repositories accept this rather than PrismaClient, so the same repository works inside and
 * outside a transaction — which is what makes the unit of work possible without duplicating them.
 */
export type Db = PrismaClient | Prisma.TransactionClient;

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
