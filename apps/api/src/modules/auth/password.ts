import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * scrypt from the standard library: memory-hard, no native dependency to build or audit.
 * The parameters are stored in the hash string, so they can be raised later without
 * invalidating existing passwords.
 */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const COST = { N: 32_768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;
const KEY_LENGTH = 32;
const SCHEME = 'scrypt';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
}

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scrypt(normalize(password), salt, KEY_LENGTH, COST);
    return [SCHEME, COST.N, COST.r, COST.p, salt.toString('base64'), derived.toString('base64')].join('$');
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const [scheme, n, r, p, salt, expected] = stored.split('$');
    if (scheme !== SCHEME || !n || !r || !p || !salt || !expected) return false;

    const expectedBytes = Buffer.from(expected, 'base64');
    const actual = await scrypt(normalize(password), Buffer.from(salt, 'base64'), expectedBytes.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: COST.maxmem,
    });
    return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
  }
}

/** Unicode-normalized so the same typed password matches regardless of input method. */
const normalize = (password: string) => password.normalize('NFKC');
