# Contributing to Gatehouse

Thanks for looking. Bug reports, provider adapters, and documentation fixes are all welcome.

## Getting a stack running

```bash
./scripts/setup-env.sh                      # writes .env with generated secrets
npm install                                 # for typecheck, tests, and editor support
npm run -w apps/api prisma -- generate      # before the first compose up, see below
docker compose up                           # postgres, redis, litellm, api, web
```

Generate the Prisma client on the host first. The api container writes it into the bind-mounted
source tree, and on Linux it does so as root — if the container gets there first, host-side
commands cannot overwrite it afterwards.

The dashboard is on <http://localhost:3000>. `curl localhost:3001/ready` says which dependency is
unhappy. Source is bind-mounted, so both apps reload on save.

## Before opening a pull request

```bash
npm run typecheck
npm test                                  # no services needed
INTEGRATION=1 npm run -w apps/api test    # needs the stack up
```

CI runs the same three, then brings up the whole stack from a fresh clone and builds the production
images. If CI is green, a fork can deploy it.

## The rules that keep this codebase workable

The backend is layered, and most review comments come down to one of these:

- **Controllers validate input, call one service, set cookies, and shape the response.** No business
  rules, no Prisma, no branching on domain state.
- **Services hold the logic and depend on interfaces** (`UnitOfWork`, `LlmGateway`, `SecretStore`,
  `SessionStore`, `PasswordHasher`, `Clock`), never on Prisma, Fastify, or `fetch`. That is what
  makes them testable with in-memory fakes instead of a database.
- **Repositories are the only place Prisma appears**, and they return domain types.
- **`container.ts` is the only composition root.** Nothing below it reads `process.env`.
- **A mutation and its audit row commit together**, inside `uow.transaction`.
- **Services throw domain errors**, never HTTP ones. Only `http/error-handler.ts` knows status codes.
- **The wire contract lives in `packages/shared`**, so both apps import the same zod schema and a
  payload change breaks the build rather than production.

Two hard constraints come from the architecture rather than taste: **LiteLLM is never forked,
patched, or queried directly** — its HTTP API is the only contract, and every call goes through
`infra/litellm/litellm-gateway.ts` — and **nothing we already delegate to LiteLLM gets
reimplemented** (keys, budgets, rate limits, cost math, routing).

## Secrets

Provider credentials and the master key must never reach the browser, a log line, an audit entry, or
an API response. Postgres stores a secret *reference*. If a change makes a secret cross one of those
boundaries, it will not be merged — `docs/security.md` explains where the boundaries are.

## Commits and scope

Small pull requests, one concern each. New behaviour comes with a test; a bug fix comes with the
test that would have caught it. Describe what you changed and why, and mention anything you decided
not to do.
