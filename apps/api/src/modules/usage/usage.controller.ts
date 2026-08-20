import { dateRangeSchema } from '@gatehouse/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContainer } from '../../container.js';
import { authOf } from '../../http/plugins/auth.js';
import { parse } from '../../http/validation.js';

export const usageController =
  ({ services, guards }: AppContainer): FastifyPluginAsync =>
  async (app) => {
    app.get('/usage', { preHandler: guards('MEMBER') }, async (request) =>
      services.usage.totals(authOf(request).organizationId, parse(dateRangeSchema, request.query)),
    );

    app.get('/usage/models', { preHandler: guards('MEMBER') }, async (request) =>
      services.usage.byModel(authOf(request).organizationId, parse(dateRangeSchema, request.query)),
    );

    app.get('/usage/providers', { preHandler: guards('MEMBER') }, async (request) =>
      services.usage.byProvider(authOf(request).organizationId, parse(dateRangeSchema, request.query)),
    );

    app.get('/usage/developers', { preHandler: guards('ADMIN') }, async (request) =>
      services.usage.byDeveloper(authOf(request).organizationId, parse(dateRangeSchema, request.query)),
    );

    app.get('/budgets', { preHandler: guards('ADMIN') }, async (request) =>
      services.usage.budgets(authOf(request).organizationId),
    );

    app.get('/connect', { preHandler: guards('MEMBER') }, async (request) => {
      const context = authOf(request);
      return services.usage.connectInfo(context.organizationId, context.userId);
    });
  };
