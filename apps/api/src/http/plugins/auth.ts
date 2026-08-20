import type { Role } from '@gatehouse/shared';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Config } from '../../core/config.js';
import { UnauthorizedError } from '../../core/errors.js';
import { type AuthContext, Authenticator } from '../../modules/auth/authenticator.js';

export const SESSION_COOKIE = 'gw_session';

declare module 'fastify' {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}

/**
 * Route guards. A route declares the minimum role it needs and receives an AuthContext whose
 * organizationId came from the session — request bodies never influence tenancy.
 */
export function createGuards(authenticator: Authenticator) {
  return function requireRole(minimum: Role = 'MEMBER'): preHandlerAsyncHookHandler {
    return async function guard(request: FastifyRequest): Promise<void> {
      const context = await authenticator.authenticate(request.cookies[SESSION_COOKIE], request.ip);
      Authenticator.assertRole(context, minimum);
      request.authContext = context;
    };
  };
}

/** Reads the context a guard established. Throws if called on an unguarded route. */
export function authOf(request: FastifyRequest): AuthContext {
  if (!request.authContext) throw new UnauthorizedError();
  return request.authContext;
}

export function setSessionCookie(reply: FastifyReply, sessionId: string, config: Config): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    path: '/',
    maxAge: config.sessionTtlSeconds,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
