#!/bin/sh
# Generate the Prisma client, apply migrations, then hand off. Running migrations here is what
# makes `docker compose up` on a fresh clone produce a working database with no extra step.
set -e
npm run -w apps/api prisma -- generate
npm run -w apps/api prisma -- migrate deploy
exec "$@"
