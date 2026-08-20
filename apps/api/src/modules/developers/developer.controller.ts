import {
  createDeveloperRequestSchema,
  idParamSchema,
  setModelAccessRequestSchema,
  updateDeveloperRequestSchema,
  uuidSchema,
} from '@gatehouse/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContainer } from '../../container.js';
import { authOf } from '../../http/plugins/auth.js';
import { parse } from '../../http/validation.js';

const keyParamsSchema = z.object({ id: uuidSchema, keyId: uuidSchema });

export const developerController =
  ({ services, guards }: AppContainer): FastifyPluginAsync =>
  async (app) => {
    app.get('/developers', { preHandler: guards('ADMIN') }, async (request) =>
      services.developers.list(authOf(request).organizationId),
    );

    app.post('/developers', { preHandler: guards('ADMIN') }, async (request, reply) => {
      const body = parse(createDeveloperRequestSchema, request.body);
      return reply.code(201).send(await services.developers.create(authOf(request), body));
    });

    app.get('/developers/:id', { preHandler: guards('ADMIN') }, async (request) => {
      const { id } = parse(idParamSchema, request.params);
      return services.developers.get(authOf(request).organizationId, id);
    });

    app.patch('/developers/:id', { preHandler: guards('ADMIN') }, async (request) => {
      const { id } = parse(idParamSchema, request.params);
      const body = parse(updateDeveloperRequestSchema, request.body);
      await services.developers.update(authOf(request), id, body);
      return { ok: true as const };
    });

    app.delete('/developers/:id', { preHandler: guards('ADMIN') }, async (request, reply) => {
      const { id } = parse(idParamSchema, request.params);
      await services.developers.remove(authOf(request), id);
      return reply.code(204).send();
    });

    app.put('/developers/:id/models', { preHandler: guards('ADMIN') }, async (request) => {
      const { id } = parse(idParamSchema, request.params);
      const body = parse(setModelAccessRequestSchema, request.body);
      return { models: await services.developers.setModelAccess(authOf(request), id, body) };
    });

    app.post(
      '/developers/:id/keys',
      { preHandler: guards('ADMIN'), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const { id } = parse(idParamSchema, request.params);
        // The one response in the system that carries a plaintext key.
        return reply.code(201).send(await services.keys.issue(authOf(request), id));
      },
    );

    app.post('/developers/:id/keys/:keyId/rotate', { preHandler: guards('ADMIN') }, async (request) => {
      const { id, keyId } = parse(keyParamsSchema, request.params);
      return services.keys.rotate(authOf(request), id, keyId);
    });

    app.post('/developers/:id/keys/:keyId/revoke', { preHandler: guards('ADMIN') }, async (request) => {
      const { id, keyId } = parse(keyParamsSchema, request.params);
      await services.keys.revoke(authOf(request), id, keyId);
      return { ok: true as const };
    });
  };
