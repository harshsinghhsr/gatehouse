import {
  addTeamMemberRequestSchema,
  createTeamRequestSchema,
  idParamSchema,
  setModelAccessRequestSchema,
  uuidSchema,
} from '@gatehouse/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContainer } from '../../container.js';
import { authOf } from '../../http/plugins/auth.js';
import { parse } from '../../http/validation.js';

const memberParamsSchema = z.object({ id: uuidSchema, userId: uuidSchema });

export const teamController =
  ({ services, guards }: AppContainer): FastifyPluginAsync =>
  async (app) => {
    app.get('/teams', { preHandler: guards('MEMBER') }, async (request) =>
      services.teams.list(authOf(request).organizationId),
    );

    app.post('/teams', { preHandler: guards('ADMIN') }, async (request, reply) => {
      const body = parse(createTeamRequestSchema, request.body);
      return reply.code(201).send(await services.teams.create(authOf(request), body));
    });

    app.get('/teams/:id', { preHandler: guards('MEMBER') }, async (request) => {
      const { id } = parse(idParamSchema, request.params);
      return services.teams.get(authOf(request).organizationId, id);
    });

    app.delete('/teams/:id', { preHandler: guards('ADMIN') }, async (request, reply) => {
      const { id } = parse(idParamSchema, request.params);
      await services.teams.delete(authOf(request), id);
      return reply.code(204).send();
    });

    app.post('/teams/:id/members', { preHandler: guards('ADMIN') }, async (request, reply) => {
      const { id } = parse(idParamSchema, request.params);
      const { userId } = parse(addTeamMemberRequestSchema, request.body);
      await services.teams.addMember(authOf(request), id, userId);
      return reply.code(201).send({ ok: true as const });
    });

    app.delete('/teams/:id/members/:userId', { preHandler: guards('ADMIN') }, async (request, reply) => {
      const { id, userId } = parse(memberParamsSchema, request.params);
      await services.teams.removeMember(authOf(request), id, userId);
      return reply.code(204).send();
    });

    app.put('/teams/:id/models', { preHandler: guards('ADMIN') }, async (request) => {
      const { id } = parse(idParamSchema, request.params);
      const { modelIds } = parse(setModelAccessRequestSchema, request.body);
      return { models: await services.teams.setModelAccess(authOf(request), id, modelIds) };
    });
  };
