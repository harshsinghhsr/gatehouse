import { createModelRequestSchema, idParamSchema, updateModelRequestSchema } from '@gatehouse/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContainer } from '../../container.js';
import { authOf } from '../../http/plugins/auth.js';
import { parse } from '../../http/validation.js';

export const modelController =
  ({ services, guards }: AppContainer): FastifyPluginAsync =>
  async (app) => {
    app.get('/models', { preHandler: guards('MEMBER') }, async (request) =>
      services.models.list(authOf(request).organizationId),
    );

    app.post('/models', { preHandler: guards('ADMIN') }, async (request, reply) => {
      const body = parse(createModelRequestSchema, request.body);
      return reply.code(201).send(await services.models.create(authOf(request), body));
    });

    app.patch('/models/:id', { preHandler: guards('ADMIN') }, async (request) => {
      const { id } = parse(idParamSchema, request.params);
      const { enabled } = parse(updateModelRequestSchema, request.body);
      return services.models.setEnabled(authOf(request), id, enabled);
    });

    app.delete('/models/:id', { preHandler: guards('ADMIN') }, async (request, reply) => {
      const { id } = parse(idParamSchema, request.params);
      await services.models.delete(authOf(request), id);
      return reply.code(204).send();
    });
  };
