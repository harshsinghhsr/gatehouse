import { createContainer } from './container.js';
import { loadConfig } from './core/config.js';
import { buildServer } from './http/server.js';
import { createLogger } from './infra/logger.js';

/** Process entry point: load configuration, build the container, serve, shut down cleanly. */
const config = loadConfig();
const logger = createLogger(config);
const container = createContainer(config, logger);
const app = await buildServer(container);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    await container.shutdown();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: '0.0.0.0' });
