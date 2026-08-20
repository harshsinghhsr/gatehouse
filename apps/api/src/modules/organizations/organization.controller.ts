import { auditQuerySchema, idParamSchema } from '@gatehouse/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContainer } from '../../container.js';
import { SESSION_COOKIE, authOf, setSessionCookie } from '../../http/plugins/auth.js';
import { parse } from '../../http/validation.js';

export const organizationController =
  ({ services, config, guards }: AppContainer): FastifyPluginAsync =>
  async (app) => {
    app.get('/organizations', { preHandler: guards('MEMBER') }, async (request) =>
      services.organizations.listForUser(authOf(request).userId),
    );

    app.post('/organizations/:id/switch', { preHandler: guards('MEMBER') }, async (request, reply) => {
      const { id } = parse(idParamSchema, request.params);
      const context = authOf(request);

      const { sessionId } = await services.organizations.switchOrganization(
        context,
        id,
        request.cookies[SESSION_COOKIE],
      );
      setSessionCookie(reply, sessionId, config);
      return { activeOrganizationId: id };
    });

    app.get('/audit-logs', { preHandler: guards('ADMIN') }, async (request) => {
      const query = parse(auditQuerySchema, request.query);
      return services.audit.list(authOf(request).organizationId, query);
    });
  };
