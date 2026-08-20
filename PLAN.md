# Gatehouse — Architecture & Implementation Plan

Status: phases 1-7 and 9 implemented, then rebuilt onto a layered architecture (controllers →
services → repositories, dependency injection through a composition root, a shared contract
package, and TanStack Query on a Vite/React frontend). Phase 8 (AWS deployment) is not built,
but the AWS Secrets Manager path is exercised locally against LocalStack. Findings from the build are folded back into the sections below;
`docs/litellm-notes.md` and `docs/security.md` carry the details.

---

## 0. Research findings (verified 2026-08-19, not assumed)

Everything below was checked against the live LiteLLM release/docs, not from memory.

| Question | Finding | Source |
|---|---|---|
| Latest LiteLLM | `1.97.0` (2026-08-16). `1.98.0-rc.1` / `1.99.0-dev.1` exist — not stable. | PyPI + GitHub releases API |
| License | MIT, **except** everything under `enterprise/` which has its own license. | repo `LICENSE` |
| Container | `ghcr.io/berriai/litellm:v1.97.0` exists (probed). No `v1.97.0-stable` tag; `main-stable` is a floating tag → don't use it. | `docker manifest inspect` |
| Virtual keys | `POST /key/generate`, `/key/update`, `/key/delete`, `/key/block`, `/key/unblock`, `/key/list`, `/key/info`, `/key/{key}/regenerate`, `/key/{key}/reset_spend`, `/key/bulk_update`. | proxy OpenAPI |
| Key response | Returns `key` (plaintext, once), **`token_id`** (hashed token = stable id), `key_name` (masked), `expires`, `created_at`. | `GenerateKeyResponse` schema |
| Key revoke without plaintext | `POST /key/delete` takes `{keys: [], key_aliases: []}` → **we can revoke by `key_alias`**, so we never store the plaintext key. | `KeyRequest` schema |
| Key list filters | `/key/list?organization_id=&team_id=&user_id=&key_alias=&status=` — enough for reconciliation. | proxy OpenAPI |
| Runtime model config | `POST /model/new` `{model_name, litellm_params, model_info}`, `/model/update`, `/model/delete`. Requires `STORE_MODEL_IN_DB=True`. **Takes effect immediately, no restart.** | docs/proxy/model_management |
| Credentials at rest | LiteLLM encrypts DB-stored provider creds with `LITELLM_SALT_KEY` (falls back to master key). Never rotate the salt after models exist. | same |
| Reusable credentials | `POST /credentials`, `/credentials/{name}`, `/credentials/by_model/{id}`; models reference `litellm_params.litellm_credential_name`. Credential name auto-tags requests → free per-credential spend. | OpenAPI + docs/proxy/credential_usage_tracking |
| Secret managers (AWS SM inside LiteLLM) | **Enterprise-only feature.** | docs/secret |
| Usage/spend | `/user/daily/activity` (breakdown by model/provider/key, paginated), `/team/daily/activity`, `/organization/daily/activity`, `/spend/logs`, `/global/spend/report` (team/customer grouping is enterprise). | docs/proxy/cost_tracking + OpenAPI |
| Anthropic SDK | Native `/v1/messages` + `/v1/messages/count_tokens` + `/anthropic/{endpoint}` passthrough. Anthropic SDK `base_url` = proxy root (no `/v1` suffix). | docs/anthropic_unified |
| Multi-tenancy primitives | LiteLLM has first-class `organization`, `team`, `user`, `budget` objects with their own CRUD + daily-activity endpoints. | OpenAPI |
| Health | `/health/liveliness`, `/health/liveness`, `/health/readiness`, `/health` (calls providers — expensive), `/health/services`. | OpenAPI |

**Caveat that drives Phase 3:** the public swagger I dumped reports `version: 1.82.6`, older than our pin. So step one of the LiteLLM phase is to boot the pinned container and dump its own `/openapi.json` — that file, not this table, is the contract.

### Decisions forced by the research

1. **LiteLLM's secret-manager integration is Enterprise → we don't use it.** Our backend is the sole source of truth for provider credentials (AWS Secrets Manager in prod, `.env` locally). We read the secret and push it to LiteLLM's `/credentials` API, which encrypts it at rest with `LITELLM_SALT_KEY`. No enterprise license required anywhere in the MVP.
2. **No generated `config.yaml` for models.** `config.yaml` holds only static settings; every provider/model is created at runtime through `/credentials` + `/model/new` with `STORE_MODEL_IN_DB=true`. No restart, no file mutation, no writes to LiteLLM's DB.
3. **Rotation does not need the plaintext key.** `/key/{key}/regenerate` takes the key in the path, which we deliberately don't store. So rotation = `/key/generate` (new alias) → return plaintext once → `/key/delete` by old `key_alias`. If Phase-3 verification shows `regenerate` accepts a `token_id`, we switch to it and get `grace_period` for free.
4. **Mirror our tenancy into LiteLLM** (org→organization, team→team, developer→internal user). This is not duplication: it's what makes `/user/daily/activity` and `/team/daily/activity` answer our dashboard queries directly instead of us summing spend logs.

---

## 1. Architecture

```
                              Internet
                                 │
                        ┌────────┴────────┐
                        │   ALB / HTTPS   │
                        └───┬─────────┬───┘
        dashboard traffic   │         │   LLM traffic (developers' SDKs)
                            │         └──────────────────────┐
              ┌─────────────┴───────────┐                    │
              │                         │                    │
        ┌─────▼─────┐            ┌──────▼──────┐      ┌──────▼───────┐
        │  web      │  fetch     │   api       │      │  LiteLLM     │
        │  Next.js  │───────────▶│  Fastify    │      │  proxy       │
        └───────────┘            └──┬───┬───┬──┘      │  v1.97.0     │
                                    │   │   │         └───┬──────┬───┘
                    ┌───────────────┘   │   └─ master ────┘      │
                    │                   │      key (admin API)   │
              ┌─────▼─────┐      ┌──────▼──────┐          ┌──────▼──────┐
              │ Postgres  │      │ AWS Secrets │          │  Providers  │
              │ (ours)    │      │  Manager    │          │ Azure/OAI/  │
              └───────────┘      └─────────────┘          │  Anthropic  │
                                                          └─────────────┘
                    ┌───────────┐        LiteLLM has its OWN Postgres schema
                    │  Redis    │◀── api cache + rate limit; also LiteLLM cache
                    └───────────┘
```

Rules encoded in the diagram: the browser never sees the master key or a provider key; the API never sits in the LLM request path; LiteLLM's DB is only ever touched by LiteLLM.

Local dev uses one Postgres server with two databases (`gateway`, `litellm`) — one container, still zero schema coupling.

---

## 2. Repository structure

npm workspaces. No Turborepo/nx until build times actually hurt.

```
gatehouse/
├── apps/
│   ├── api/          Fastify + TypeScript
│   │   ├── src/
│   │   │   ├── server.ts            app factory (testable, no listen)
│   │   │   ├── plugins/             auth, prisma, redis, ratelimit, errors, requestId
│   │   │   ├── routes/              auth, orgs, providers, models, developers,
│   │   │   │                        teams, keys, usage, budgets, audit, health
│   │   │   ├── litellm/             client.ts (generated types), service.ts, sync.ts
│   │   │   ├── providers/           registry.ts, azure.ts, openai.ts, anthropic.ts
│   │   │   ├── secrets/             index.ts (interface), aws.ts, env.ts
│   │   │   └── lib/                 audit.ts, rbac.ts, ssrf.ts, redact.ts
│   │   ├── prisma/schema.prisma
│   │   └── test/
│   └── web/          Next.js App Router + Tailwind + shadcn/ui
├── packages/
│   └── shared/       zod schemas + inferred types, shared by api and web
├── litellm/
│   ├── config.yaml   settings only — no model_list
│   └── README.md     pinned version + upgrade runbook
├── infrastructure/
│   ├── docker/       Dockerfile.api, Dockerfile.web
│   └── terraform/    Phase 8
├── docs/
├── docker-compose.yml
├── .env.example
├── LICENSE           Apache-2.0
└── README.md
```

`packages/types` and `packages/config` from the spec are folded into `packages/shared` — three packages for one set of zod schemas is scaffolding for its own sake. Split later if it ever hurts.

---

## 3. Database schema (Prisma)

Ours only. No provider secrets, no plaintext gateway keys, no LiteLLM tables.

```prisma
model Organization {
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique          // also the LiteLLM model-name namespace
  litellmOrgId String?  @unique       // mirrored LiteLLM organization
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model User {
  id           String   @id @default(uuid())
  email        String   @unique
  name         String
  passwordHash String?                 // argon2id; null once OIDC lands
  status       UserStatus @default(ACTIVE)   // ACTIVE | DISABLED
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model Membership {
  id     String @id @default(uuid())
  organizationId String
  userId String
  role   Role                          // OWNER | ADMIN | MEMBER
  litellmUserId  String?               // mirrored LiteLLM internal user
  createdAt DateTime @default(now())
  @@unique([organizationId, userId])
}

model Team {
  id String @id @default(uuid())
  organizationId String
  name String
  slug String
  litellmTeamId String? @unique
  @@unique([organizationId, slug])
}

model TeamMember { id String @id @default(uuid()) teamId String; userId String; @@unique([teamId, userId]) }

model Provider {
  id String @id @default(uuid())
  organizationId String
  name String                          // "Azure Prod EU"
  type ProviderType                    // AZURE_OPENAI | OPENAI | ANTHROPIC
  status ProviderStatus @default(ACTIVE)
  secretRef String                     // ARN or env:// URI — never the secret
  config Json                          // non-secret: apiBase, apiVersion
  litellmCredentialName String? @unique  // "org-slug__provider-id"
  lastTestedAt DateTime?
  lastTestError String?
  @@unique([organizationId, name])
}

model ProviderModel {
  id String @id @default(uuid())
  providerId String
  publicModelName String                // "gpt-5"
  providerModelName String               // "azure/my-gpt5-deployment"
  litellmModelName String  @unique       // "{orgSlug}/gpt-5" — global namespace
  litellmModelId String?  @unique        // model_info.id returned by /model/new
  enabled Boolean @default(true)
  metadata Json
  @@unique([providerId, publicModelName])
}

model ModelAccess {              // absence = denied
  id String @id @default(uuid())
  organizationId String
  userId String?                 // exactly one of userId / teamId
  teamId String?
  providerModelId String
  @@unique([userId, teamId, providerModelId])
}

model GatewayKeyReference {
  id String @id @default(uuid())
  organizationId String
  userId String?
  teamId String?
  keyAlias String @unique        // our handle into LiteLLM — how we revoke
  litellmKeyId String            // token_id (hashed token)
  keyPrefix String?              // "sk-...AbCd" for display only
  status KeyStatus @default(ACTIVE)   // ACTIVE | REVOKED | ROTATED
  expiresAt DateTime?
  revokedAt DateTime?
  createdAt DateTime @default(now())
}

model Budget {
  id String @id @default(uuid())
  organizationId String
  userId String?
  teamId String?
  maxBudget Decimal
  period BudgetPeriod            // DAILY | MONTHLY
  rpmLimit Int?
  tpmLimit Int?
}

model AuditLog {
  id String @id @default(uuid())
  organizationId String
  actorUserId String?
  action String                  // PROVIDER_CREATED, API_KEY_REVOKED, ...
  targetType String
  targetId String
  metadata Json                  // redacted at the writer, not the reader
  ip String?
  createdAt DateTime @default(now())
  @@index([organizationId, createdAt])
}
```

`lastUsedAt` on keys is deliberately absent — LiteLLM already knows it; we read it from `/key/info` rather than maintaining a write on every request.

**Model naming under multi-tenancy.** One LiteLLM instance serves every org, so `model_name` must be globally unique: we register `{orgSlug}/gpt-5`. Developers still type `gpt-5` because the key carries `aliases: {"gpt-5": "acme/gpt-5"}`. Single-org self-hosts get the same DX with the alias layer as a no-op.

---

## 4. API specification

Sessions are httpOnly cookies; `organizationId` always comes from the session, never the body.

```
POST   /api/auth/register           bootstrap: first user + org (disabled after first, unless ALLOW_SIGNUP)
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/me                      user + memberships + active org

GET    /api/organizations           orgs the caller belongs to
POST   /api/organizations/:id/switch

GET    /api/providers
POST   /api/providers               body: {name, type, credentials{...}, config{...}}
GET    /api/providers/:id           never returns credentials
PATCH  /api/providers/:id
DELETE /api/providers/:id
POST   /api/providers/:id/test      server-side credential probe
POST   /api/providers/:id/models/discover

GET    /api/models
POST   /api/models                  registers with LiteLLM
PATCH  /api/models/:id
DELETE /api/models/:id

GET    /api/developers
POST   /api/developers
GET    /api/developers/:id
PATCH  /api/developers/:id          status, budget, rate limits
DELETE /api/developers/:id
PUT    /api/developers/:id/models   full replace of model access

POST   /api/developers/:id/keys              → {key} exactly once
GET    /api/developers/:id/keys
POST   /api/developers/:id/keys/:keyId/rotate → {key} exactly once
POST   /api/developers/:id/keys/:keyId/revoke

GET    /api/teams  POST /api/teams  GET|PATCH|DELETE /api/teams/:id
POST   /api/teams/:id/members       DELETE /api/teams/:id/members/:userId

GET    /api/usage?from=&to=                  totals
GET    /api/usage/developers|models|providers
GET    /api/budgets     PATCH /api/budgets/:id
GET    /api/audit-logs?action=&actor=&cursor=
GET    /api/connect                 base URLs + model list + SDK snippets

GET    /health          liveness, no dependencies
GET    /ready           db + redis + litellm/health/readiness
```

Errors are uniform: `{ error: { code, message, details?, requestId } }`. Codes map per spec §40; LiteLLM errors are translated, never forwarded raw.

OpenAPI is generated from the zod schemas via `fastify-type-provider-zod` + `@fastify/swagger` — spec written once, not twice.

---

## 5. LiteLLM integration design

One module, `apps/api/src/litellm/`, is the only place that speaks HTTP to LiteLLM.

```ts
class LiteLLMService {
  // keys
  createKey(o: {alias, litellmUserId, litellmTeamId, models: string[],
                aliases, maxBudget?, budgetDuration?, rpmLimit?, tpmLimit?, duration?})
      -> {key, tokenId, keyName, expires}      // POST /key/generate
  revokeKeyByAlias(alias)                      // POST /key/delete {key_aliases:[alias]}
  rotateKey(oldAlias, newAlias, params)        // generate new, then delete old
  updateKey(tokenId, patch)                    // POST /key/update
  getKey(tokenId)                              // GET  /key/info
  listKeys(filter)                             // GET  /key/list
  blockKey / unblockKey                        // /key/block, /key/unblock

  // tenancy mirror
  upsertOrganization / upsertTeam / upsertUser // /organization/new, /team/new, /user/new

  // providers + models
  upsertCredential(name, values, info)         // POST /credentials
  deleteCredential(name)                       // DELETE /credentials/{name}
  addModel(modelName, litellmParams, info)     // POST /model/new  -> model id
  updateModel(id, patch) / deleteModel(id)     // /model/{id}/update, /model/delete

  // usage
  userActivity(litellmUserId, from, to)        // GET /user/daily/activity
  teamActivity / organizationActivity
  spendLogs(filter)                            // GET /spend/logs

  health()                                     // GET /health/readiness (never /health)
}
```

Implementation notes:

- Master key is loaded once from the secret provider at boot, held in memory, never logged, never serialized into an error.
- Every call gets a 10s timeout, 2 retries on 5xx/network with jitter, and a circuit breaker so a LiteLLM outage degrades the dashboard instead of hanging it.
- **Types are generated, not hand-written**: `curl litellm:4000/openapi.json | openapi-typescript` against the *pinned* image, committed as `litellm/openapi.v1.97.0.json`. A CI job diffs the live container's spec against the committed one, so a LiteLLM bump that changes a field fails the build instead of production.
- Reconciliation job (`sync.ts`): on boot and every 15 min, compare our `ProviderModel` / `GatewayKeyReference` rows against `/model/info` and `/key/list`. Log drift; expose it on the dashboard. Cheap insurance against a partial failure mid-write.

**Provider onboarding flow (no restart, no config file):**
```
credentials → secrets provider → secretRef stored in our DB
           → POST /credentials {credential_name: "acme__prov-123", credential_values:{...}}
model      → POST /model/new {model_name:"acme/gpt-5",
                              litellm_params:{model:"azure/my-deploy",
                                              litellm_credential_name:"acme__prov-123"}}
           → store returned model id
```
Credential values live in LiteLLM's DB encrypted with `LITELLM_SALT_KEY`; AWS Secrets Manager remains the source of truth we can always re-push from.

---

## 6. Secrets architecture

```ts
interface SecretStore {
  put(ref: string, value: Record<string,string>): Promise<string>  // returns canonical ref
  get(ref: string): Promise<Record<string,string>>
  delete(ref: string): Promise<void>
}
```
Two implementations, chosen by `SECRETS_BACKEND=aws|env`:

- **aws** — `gatehouse/{env}/{orgId}/providers/{providerId}`, accessed via task-role IAM. Policy is scoped to that path prefix, `secretsmanager:GetSecretValue|CreateSecret|PutSecretValue|DeleteSecret` only. `LITELLM_MASTER_KEY`, `LITELLM_SALT_KEY`, `SESSION_SECRET`, `DATABASE_URL` live under `gatehouse/{env}/platform/*`.
- **env** — local dev; `secretRef` is `env://PROVIDER_<ID>` backed by an in-memory map seeded from `.env`. Zero AWS dependency for `docker compose up`.

Invariants, enforced by tests: provider credentials never appear in an API response, a log line, an audit entry, or a `GET /api/providers/:id` payload. A pino redaction serializer strips `api_key|apiKey|authorization|password|secret|token|key` from every log object, and there is one test that asserts it.

---

## 7. Local Docker architecture

```yaml
services:
  postgres:   # 17-alpine, initdb creates both `gateway` and `litellm` databases
  redis:      # valkey 8-alpine
  litellm:    # ghcr.io/berriai/litellm:v1.97.0
              # env: LITELLM_MASTER_KEY, LITELLM_SALT_KEY, DATABASE_URL (litellm db),
              #      STORE_MODEL_IN_DB=True, REDIS_URL
              # volume: ./litellm/config.yaml -> /app/config.yaml
              # healthcheck: GET /health/liveliness
  api:        # node 22, prisma migrate deploy on start, depends_on healthy pg/redis/litellm
  web:        # next dev, NEXT_PUBLIC_API_URL only — no secrets ever
```

`litellm/config.yaml` — settings only, no `model_list`:
```yaml
general_settings:
  store_model_in_db: true
  database_url: os.environ/DATABASE_URL
litellm_settings:
  drop_params: true
  cache: true
  cache_params: {type: redis, url: os.environ/REDIS_URL}
```
(Master key comes from `LITELLM_MASTER_KEY` env, not the file.) Exact syntax is re-verified against the pinned image in Phase 1 before this is committed.

`docker compose up` must produce a working stack with no AWS and no provider keys; the app is usable up to the point where you add a provider.

---

## 8. AWS architecture (v1)

ALB (HTTPS, ACM cert) → three ECS Fargate services in private subnets:

| Service | Notes |
|---|---|
| `web` | ALB rule `/*` |
| `api` | ALB rule `/api/*`, task role with the scoped Secrets Manager policy |
| `litellm` | **internal** target group; ALB rule for `/v1/*`, `/chat/*`, `/models`, `/anthropic/*` only. `/key/*`, `/model/*`, `/credentials/*`, `/ui`, `/spend/*` are **not** routed from the internet — admin API reachable only from the api service's security group. |

Plus: RDS Postgres 17 (two databases, single instance for v1), ElastiCache Valkey, Secrets Manager, ECR, CloudWatch Logs with a metric filter alarming on 5xx and on auth failures, Route 53. Terraform, one environment, no modules-for-modules'-sake.

Not in v1: Kubernetes, multi-region, autoscaling policies beyond CPU target tracking, WAF (add when a real abuse case appears).

---

## 9. Security model

| Control | Implementation |
|---|---|
| Tenant isolation | Every Prisma query goes through a repository helper that requires `organizationId` from the session. One test per route asserts cross-org 404. |
| AuthN | argon2id (memory 64MB, t=3), session id in httpOnly+Secure+SameSite=Lax cookie, server-side sessions in Redis with idle+absolute expiry. |
| CSRF | SameSite=Lax + Origin header check on all non-GET. |
| AuthZ | `requireRole(OWNER|ADMIN)` preHandler; MEMBERs can read their own keys/usage only. |
| SSRF | Provider `api_base` validated: https only, hostname must match the provider's allowed suffix list (`*.openai.azure.com`, `api.openai.com`, `api.anthropic.com`), DNS resolved and rejected if it lands in a private/link-local/metadata range, no redirects followed on the test call. |
| Secret exposure | Redaction serializer + response DTOs that whitelist fields; "no secret in response" contract test. |
| Master key | Backend-only, never in web env, never in an image layer, never in an error body. |
| Gateway keys | Plaintext returned exactly once, never persisted, never logged; DB stores alias + `token_id` + prefix. |
| Rate limits | `@fastify/rate-limit` on `/api/auth/login` (5/min/IP+email), key creation, provider creation. LLM traffic rate limiting is LiteLLM's job. |
| Input validation | zod at every boundary; Prisma parameterizes everything. |
| Audit | Written in the same transaction as the mutation it records. |
| Dependencies | `npm audit` + Dependabot in CI; pinned LiteLLM digest. |

---

## 10. Implementation plan

Each phase ends green and demoable. Nothing ships without the check that proves it.

**Phase 1 — Scaffold (foundation)**
Workspaces, Fastify app factory, Next.js shell, Prisma schema + first migration, docker-compose with all five services healthy, `.env.example`, health/ready endpoints, CI (typecheck, lint, test).
*Verify:* `docker compose up` → `/ready` returns all-healthy; pinned LiteLLM's `/openapi.json` dumped and committed.

**Phase 2 — Auth, orgs, RBAC**
register/login/logout/me, sessions, memberships, roles, org-scoped repository helper, audit log writer, login rate limit.
*Verify:* cross-org isolation tests; a MEMBER hitting an ADMIN route gets 403.

**Phase 3 — LiteLLM integration**
Generated client types, `LiteLLMService`, master-key loading, health check, key create/revoke/rotate, tenancy mirror.
*Verify against the pinned container, not docs:* does `/key/{key}/regenerate` accept a `token_id`? Is `/key/delete` by `key_alias` honored? Does `/user/daily/activity` shape match? Findings recorded in `docs/litellm-notes.md`; the rotation implementation follows whichever answer comes back.

**Phase 4 — Providers**
`SecretStore` (env + aws), provider registry, Azure OpenAI end to end first — create → validate → `/credentials` → `/model/new` → callable. Then generalize to OpenAI and Anthropic; the third one should be a config object, not new code paths. SSRF guard lands here.
*Verify:* real chat completion through the gateway using an Azure deployment.

**Phase 5 — Developers, keys, access, budgets**
Developer CRUD, teams, model access → the `models` array and `aliases` map on the key, budgets → LiteLLM `max_budget`/`budget_duration`/`rpm_limit`, revoke, rotate.
*Verify:* full acceptance flow from spec §48, with a `mock_response` model so CI needs no provider — create key → call → revoke → call fails 401.

**Phase 6 — Usage**
Read-through from `/user|team|organization/daily/activity`, 60s Redis cache, dashboard aggregates by developer/model/provider. No independent cost math.

**Phase 7 — UI**
Dashboard, providers, models, developers, teams, usage, budgets, audit logs, settings, and the Connect page with copy-paste OpenAI + Anthropic snippets. Tailwind + shadcn/ui, dark mode via `next-themes`.

**Phase 8 — AWS**
Terraform, ECR + GitHub Actions deploy, the ALB routing rules that keep LiteLLM's admin API off the internet, CloudWatch alarms, deployment doc.

**Phase 9 — Security pass**
Threat-model walkthrough of every row in §9, dependency audit, log scrape for leaked secrets, a deliberate attempt to reach another org's data and to reach `/key/generate` through the public ALB.

**Ordering rationale:** 3 before 4 because provider onboarding is defined by what LiteLLM's API actually accepts; 5 before 6 because usage data needs keys that have spent something.

---

## Open decisions taken (so nobody re-litigates them)

- Fastify over NestJS — a REST control plane with ~30 routes doesn't need DI containers and decorators.
- Prisma over Drizzle — migrations and generated types are the fast path here.
- npm workspaces over Turborepo — two apps, one package.
- Apache-2.0 for our code; LiteLLM stays an unmodified upstream container image, attributed in `NOTICE`.
- Sessions over JWT — revocation is free and the browser is the only consumer.
- Single Postgres instance, two databases, in both dev and v1 prod. Schemas stay decoupled; the split into separate instances is a config change, not a refactor.
- One shared LiteLLM instance across orgs, with org-namespaced model names + per-key aliases. A per-org LiteLLM deployment is the escape hatch if an org ever needs hard isolation.
