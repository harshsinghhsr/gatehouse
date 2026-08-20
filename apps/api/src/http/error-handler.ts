import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../core/errors.js';

/**
 * The single place where a thrown error becomes a response. Domain errors carry their own
 * status and code; anything else is an unexpected failure and is reported as 500 with no
 * detail, because an internal message may quote a connection string or a credential.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      if (error.status >= 500) request.log.error({ err: error }, 'request failed');
      return reply.code(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
    }

    // Fastify's own 4xx (malformed JSON, unsupported media type, rate limit) are safe to relay.
    const status = error.statusCode ?? 500;
    if (status < 500) {
      return reply.code(status).send({
        error: { code: error.code ?? 'bad_request', message: error.message, requestId: request.id },
      });
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({
      error: { code: 'internal_error', message: 'Internal server error', requestId: request.id },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: { code: 'not_found', message: 'Route not found', requestId: request.id },
    }),
  );
}
