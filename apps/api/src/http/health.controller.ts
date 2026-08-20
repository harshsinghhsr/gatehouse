import type { HealthReport } from '@gatehouse/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContainer } from '../container.js';

/**
 * Liveness has no dependencies, so a sick database never gets the container killed and
 * restarted into the same sick database. Readiness reports each dependency separately.
 */
export const healthController =
  ({ healthChecks }: AppContainer): FastifyPluginAsync =>
  async (app) => {
    app.get('/health', async () => ({ status: 'ok' as const }));

    app.get('/ready', async (_request, reply) => {
      const results = await Promise.all(
        Object.entries(healthChecks).map(async ([name, probe]) => {
          try {
            await probe();
            return [name, 'ok'] as const;
          } catch {
            return [name, 'down'] as const;
          }
        }),
      );

      const ready = results.every(([, state]) => state === 'ok');
      const report: HealthReport = {
        status: ready ? 'ready' : 'degraded',
        services: Object.fromEntries(results),
      };
      return reply.code(ready ? 200 : 503).send(report);
    });
  };
