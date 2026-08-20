import { defineConfig, env } from 'prisma/config';

// Node 22's built-in .env loader. Absent in CI and containers, where the env is already set.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url).pathname);
} catch {
  // no .env file — expected outside local dev
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
