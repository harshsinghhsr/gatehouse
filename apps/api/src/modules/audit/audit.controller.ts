import { auditQuerySchema } from '@gatehouse/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContainer } from '../../container.js';
import { parse } from '../../http/validation.js';

export const auditController =
  ({ services, guards }: AppContainer): FastifyPluginAsync =>
  async (app) => {
    app.get('/audit-logs', { preHandler: guards('ADMIN') }, async (request) =>
      services.audit.list(parse(auditQuerySchema, request.query)),
    );
  };
