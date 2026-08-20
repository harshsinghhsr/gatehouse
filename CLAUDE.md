# Gatehouse

Self-hosted control plane around an unmodified LiteLLM proxy. We own organizations, users, providers,
the model catalog, key lifecycle, budgets, and the dashboard. LiteLLM owns LLM traffic,
virtual keys, rate limits, and spend. See [PLAN.md](PLAN.md).

## Working agreements

**Use the `ponytail` skill for every coding task** — writing, refactoring, fixing, reviewing,
or picking a dependency. Laziest solution that actually works: stdlib before a dependency,
one line before fifty, delete before add, no speculative abstractions. Not lazy about
understanding the problem, security, validation, or error handling.

Also: `superpowers:systematic-debugging` before proposing a fix for any bug.

## Architecture rules

The backend is layered. Each rule below exists because breaking it caused a real problem before.

- **Controllers do four things**: validate input, call one service, set cookies, shape the
  response. No business rules, no Prisma, no branching on domain state.
- **Services hold the business logic** and depend on interfaces (`UnitOfWork`, `LlmGateway`,
  `SecretStore`, `SessionStore`, `PasswordHasher`, `Clock`) — never on Prisma, Fastify, or fetch.
  That is what makes them testable with in-memory fakes.
- **Repositories are the only place Prisma appears.** They return domain types, never Prisma rows.
- **`container.ts` is the composition root.** Everything is constructed once, there, and injected
  downward. Nothing below it reads `process.env` or news up an adapter.
- **A mutation and its audit row commit together**, inside `uow.transaction`.
- **Domain errors, not HTTP.** Services throw `NotFoundError`/`ConflictError`/…; only
  `http/error-handler.ts` knows about status codes.
- **The wire contract lives in `packages/shared`.** Both apps import the same zod schemas; never
  hand-copy a type into the web app.

## Hard rules

- Never duplicate what LiteLLM already does (keys, budgets, rate limits, cost math, routing).
- Never fork, vendor, or patch LiteLLM. Pinned image only: `ghcr.io/berriai/litellm:v1.97.0`.
- Never query or migrate LiteLLM's database. Its API is the only contract.
- All LiteLLM HTTP calls go through `infra/litellm/litellm-gateway.ts` — nowhere else.
- Provider secrets and the master key never reach the browser, a log line, an audit entry, or an
  API response. Postgres stores a secret *reference*, never a secret.
- Gateway keys: the plaintext is returned exactly once and never stored. We keep alias +
  `token_id` + a masked prefix; revocation goes through the alias.
- `organizationId` always comes from the session, never from a request body or query.
- **The design system is Geist, and it lives in `apps/web/src/styles/global.css`.** Components
  come from `shared/ui`; pages compose them and never invent a one-off style. Reach for a token,
  not a hex value, and check both themes before calling it done.
- The browser talks to the API same-origin under `/api` (nginx in production, the Vite proxy in
  development). Nothing environment-specific is ever baked into the frontend bundle.
- This is meant to be forked and deployed unmodified: a change that only works with hand-editing
  is not finished. `docker compose up` and the prod compose must both work from a fresh clone.

## Commands

    ./scripts/setup-env.sh                 # writes .env with generated secrets
    docker compose up                      # postgres, redis, litellm, api, web
    docker compose --profile aws up -d localstack   # AWS stand-in for the Secrets Manager path
    docker compose -f docker-compose.prod.yml up -d --build   # the deployment stack

    npm run typecheck                      # every workspace
    npm test                               # unit + HTTP tests, no services needed
    INTEGRATION=1 npm run -w apps/api test # adds the acceptance and AWS contract tests

    # migrations run inside the container, which already holds DATABASE_URL
    docker compose exec api npm run -w apps/api prisma -- migrate dev --name <name>

## Layout

    packages/shared          zod contracts shared by both apps
    apps/api/src/core        config, domain errors, ports, unit-of-work, gateway port
    apps/api/src/infra       adapters: prisma, redis, litellm, secrets, logger
    apps/api/src/modules     one folder per domain: controller, service, repository
    apps/api/src/http        server, error handler, guards, validation
    apps/api/src/container.ts   composition root
    apps/web/src/features    one folder per screen: queries.ts + page component
    apps/web/src/shared      api client, query keys, ui primitives, formatting
    litellm/                 config.yaml (settings only) + pinned openapi snapshot
    infrastructure/docker/   images, nginx config, the boot entrypoint
    scripts/setup-env.sh     generates .env; the first thing a fork runs
