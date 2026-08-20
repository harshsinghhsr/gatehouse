import { loginRequestSchema, registerRequestSchema } from '@gatehouse/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContainer } from '../../container.js';
import { SESSION_COOKIE, authOf, clearSessionCookie, setSessionCookie } from '../../http/plugins/auth.js';
import { parse } from '../../http/validation.js';

/**
 * Controllers do four things and nothing else: validate input, call one service, set cookies,
 * and shape the response. No branching on business rules lives here.
 */
export const authController =
  ({ services, config, guards }: AppContainer): FastifyPluginAsync =>
  async (app) => {
    app.post(
      '/auth/register',
      { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
      async (request, reply) => {
        const body = parse(registerRequestSchema, request.body);
        const signedIn = await services.auth.register(body, request.ip);

        setSessionCookie(reply, signedIn.sessionId, config);
        return reply.code(201).send({ user: signedIn.user });
      },
    );

    app.post(
      '/auth/login',
      {
        // Per account rather than per IP, so one attacker cannot lock every user out. The
        // global per-IP limit is what stops password spraying across many accounts.
        config: {
          rateLimit: {
            max: 5,
            timeWindow: '1 minute',
            keyGenerator: (request: { body?: unknown; ip: string }) =>
              `login:${(request.body as { email?: string } | undefined)?.email ?? request.ip}`,
          },
        },
      },
      async (request, reply) => {
        const body = parse(loginRequestSchema, request.body);
        const signedIn = await services.auth.signIn(body);

        setSessionCookie(reply, signedIn.sessionId, config);
        return { user: signedIn.user };
      },
    );

    app.post('/auth/logout', async (request, reply) => {
      await services.auth.signOut(request.cookies[SESSION_COOKIE]);
      clearSessionCookie(reply);
      return { ok: true as const };
    });

    app.get('/me', { preHandler: guards('MEMBER') }, async (request) => {
      const context = authOf(request);
      return services.auth.describe(
        { userId: context.userId, organizationId: context.organizationId },
        context.role,
      );
    });
  };
