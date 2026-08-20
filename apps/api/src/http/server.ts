import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { AppContainer } from '../container.js';
import { CrossOriginError } from '../core/errors.js';
import { authController } from '../modules/auth/auth.controller.js';
import { developerController } from '../modules/developers/developer.controller.js';
import { modelController } from '../modules/models/model.controller.js';
import { organizationController } from '../modules/organizations/organization.controller.js';
import { providerController } from '../modules/providers/provider.controller.js';
import { teamController } from '../modules/teams/team.controller.js';
import { usageController } from '../modules/usage/usage.controller.js';
import { registerErrorHandler } from './error-handler.js';
import { healthController } from './health.controller.js';

/** Wires the container to HTTP. This file knows about Fastify; nothing under modules/ does. */
export async function buildServer(container: AppContainer): Promise<FastifyInstance> {
  const { config, logger } = container;

  // A hop count is expressed as proxy-addr's predicate form: trust the first n proxies from
  // this process outwards, and treat everything beyond them as client-controlled.
  const hops = config.trustProxy;
  const trustProxy = typeof hops === 'number' ? (_address: string, hop: number) => hop < hops : hops;

  const app: FastifyInstance = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    trustProxy,
    genReqId: () => randomUUID(),
    bodyLimit: 256 * 1024,
  });

  await app.register(cors, { origin: config.webOrigin, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, {
    // A coarse per-IP ceiling for the whole API; individual routes tighten it further.
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // preHandler rather than onRequest so route-level key generators can read the body.
    hook: 'preHandler',
  });

  // CSRF: session cookies are SameSite=Lax, and a mutation must come from our own origin.
  app.addHook('onRequest', async (request) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
    const origin = request.headers.origin;
    if (origin && origin !== config.webOrigin) {
      throw new CrossOriginError();
    }
  });

  registerErrorHandler(app);

  await app.register(healthController(container));
  for (const controller of [
    authController,
    organizationController,
    providerController,
    modelController,
    developerController,
    teamController,
    usageController,
  ]) {
    await app.register(controller(container), { prefix: '/api' });
  }

  return app;
}
