import { createProviderRequestSchema, idParamSchema, updateProviderRequestSchema } from '@gatehouse/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContainer } from '../../container.js';
import { authOf } from '../../http/plugins/auth.js';
import { parse } from '../../http/validation.js';

export const providerController =
  ({ services, guards }: AppContainer): FastifyPluginAsync =>
  async (app) => {
    app.get('/provider-types', { preHandler: guards('ADMIN') }, async () => services.providers.listTypes());

    app.get('/providers', { preHandler: guards('MEMBER') }, async (request) =>
      services.providers.list(authOf(request).organizationId),
    );

    app.get('/providers/:id', { preHandler: guards('MEMBER') }, async (request) => {
      const { id } = parse(idParamSchema, request.params);
      return services.providers.get(authOf(request).organizationId, id);
    });

    app.post(
      '/providers',
      { preHandler: guards('ADMIN'), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const body = parse(createProviderRequestSchema, request.body);
        return reply.code(201).send(await services.providers.create(authOf(request), body));
      },
    );

    app.patch('/providers/:id', { preHandler: guards('ADMIN') }, async (request) => {
      const { id } = parse(idParamSchema, request.params);
      const body = parse(updateProviderRequestSchema, request.body);
      return services.providers.update(authOf(request), id, body);
    });

    app.post('/providers/:id/test', { preHandler: guards('ADMIN') }, async (request) => {
      const { id } = parse(idParamSchema, request.params);
      return services.providers.test(authOf(request).organizationId, id);
    });

    app.delete('/providers/:id', { preHandler: guards('ADMIN') }, async (request, reply) => {
      const { id } = parse(idParamSchema, request.params);
      await services.providers.delete(authOf(request), id);
      return reply.code(204).send();
    });
  };
