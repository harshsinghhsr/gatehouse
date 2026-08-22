import { randomUUID } from 'node:crypto';
import type { IssuedKey } from '@gatehouse/shared';
import { ConflictError, NotFoundError } from '../../core/errors.js';
import type { LlmGateway } from '../../core/gateway.js';
import type { Clock } from '../../core/ports.js';
import type { UnitOfWork } from '../../core/unit-of-work.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/authenticator.js';
import type { AccessService } from './access.service.js';

/**
 * Key lifecycle. The plaintext key exists in this process for exactly as long as it takes to
 * return it: it is never written to the database, an audit row, or a log line.
 */
export class KeyService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly gateway: LlmGateway,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async issue(context: AuthContext, userId: string): Promise<IssuedKey> {
    const user = await this.access.requireUser(userId);
    if (user.status !== 'ACTIVE') throw new ConflictError('This developer is disabled');

    const alias = keyAlias(user.email);
    const spec = await this.access.buildKeySpec(userId, alias);
    const issued = await this.gateway.issueKey(spec);

    const reference = await this.uow.transaction(async (repos) => {
      const created = await repos.keys.create({
        userId,
        keyAlias: alias,
        litellmKeyId: issued.keyId,
        keyPrefix: mask(issued.secret),
        expiresAt: issued.expiresAt,
      });
      await this.audit.record(
        context,
        {
          action: 'API_KEY_CREATED',
          targetType: 'key',
          targetId: created.id,
          metadata: { keyAlias: alias, developer: user.email },
        },
        repos,
      );
      return created;
    });

    return { id: reference.id, key: issued.secret, keyPrefix: reference.keyPrefix };
  }

  /**
   * Rotation mints the replacement before revoking the old key, so a developer is never left
   * without a working credential if the second call fails.
   */
  async rotate(context: AuthContext, userId: string, keyId: string): Promise<IssuedKey> {
    const existing = await this.uow.repos.keys.findById(keyId);
    if (!existing || existing.userId !== userId) throw new NotFoundError('Key');
    if (existing.status !== 'ACTIVE') throw new ConflictError('This key is no longer active');

    const issued = await this.issue(context, userId);
    await this.gateway.revokeKeyByAlias(existing.keyAlias);

    await this.uow.transaction(async (repos) => {
      await repos.keys.markInactive(existing.id, 'ROTATED', this.clock.now());
      await this.audit.record(
        context,
        {
          action: 'API_KEY_ROTATED',
          targetType: 'key',
          targetId: issued.id,
          metadata: { replaced: existing.id },
        },
        repos,
      );
    });

    return issued;
  }

  async revoke(context: AuthContext, userId: string, keyId: string): Promise<void> {
    const key = await this.uow.repos.keys.findById(keyId);
    if (!key || key.userId !== userId) throw new NotFoundError('Key');
    if (key.status !== 'ACTIVE') return;

    await this.gateway.revokeKeyByAlias(key.keyAlias);
    await this.uow.transaction(async (repos) => {
      await repos.keys.markInactive(key.id, 'REVOKED', this.clock.now());
      await this.audit.record(
        context,
        {
          action: 'API_KEY_REVOKED',
          targetType: 'key',
          targetId: key.id,
          metadata: { keyAlias: key.keyAlias },
        },
        repos,
      );
    });
  }

  /** Used when a developer is disabled or removed: access must stop at once. */
  async revokeAllForUser(userId: string): Promise<number> {
    const keys = await this.uow.repos.keys.listActiveForUser(userId);
    for (const key of keys) {
      await this.gateway.revokeKeyByAlias(key.keyAlias);
      await this.uow.repos.keys.markInactive(key.id, 'REVOKED', this.clock.now());
    }
    return keys.length;
  }
}

/** Unique forever: the alias is the handle we revoke by, so it must never be reused. */
function keyAlias(email: string): string {
  const local = email.split('@')[0]?.replace(/[^a-zA-Z0-9._-]/g, '') || 'dev';
  return `${local}--${randomUUID().slice(0, 8)}`;
}

/** Enough to recognize a key in a list, far too little to use one. */
function mask(secret: string): string {
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`;
}
