# Single-tenant Gatehouse, Team Leads, and floci — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the organization tenancy layer from Gatehouse, add a team `LEAD` role that can manage its own team, and replace the archived LocalStack with floci.

**Architecture:** Gatehouse becomes single-tenant — one deployment, one implicit organization. `Organization` and `Membership` are deleted; `role` and `litellmUserId` move onto `User`; every `organizationId` parameter and column disappears. Models are namespaced by provider slug instead of org slug. `TeamMember` gains a `role`, and the "may I manage this team" decision lives in `TeamService`, not in a route guard, because it is a database read.

**Tech Stack:** TypeScript, Fastify, Prisma 7 / PostgreSQL, Redis, zod (`packages/shared`), React + TanStack Query, `node:test`, Docker Compose, LiteLLM `v1.97.0` (pinned), floci.

**Spec:** [docs/superpowers/specs/2026-08-22-single-tenant-and-floci-design.md](../specs/2026-08-22-single-tenant-and-floci-design.md)

## Global Constraints

- Never fork, vendor, or patch LiteLLM. Pinned image only: `ghcr.io/berriai/litellm:v1.97.0`.
- All LiteLLM HTTP calls go through `apps/api/src/infra/litellm/litellm-gateway.ts` — nowhere else.
- Controllers validate input, call one service, set cookies, and shape the response. No business rules, no Prisma, no branching on domain state.
- Services depend on interfaces (`UnitOfWork`, `LlmGateway`, `SecretStore`, `SessionStore`, `PasswordHasher`, `Clock`), never on Prisma, Fastify, or fetch.
- Repositories are the only place Prisma appears, and they return domain types.
- `container.ts` is the composition root. Nothing below it reads `process.env`.
- A mutation and its audit row commit together, inside `uow.transaction`.
- Services throw domain errors (`NotFoundError`/`ConflictError`/`ForbiddenError`); only `http/error-handler.ts` knows status codes.
- The wire contract lives in `packages/shared`. Never hand-copy a type into the web app.
- Provider secrets and the master key never reach the browser, a log line, an audit entry, or an API response.
- `userId` and `role` always come from the session, never from a request body or query.
- Design system is Geist, in `apps/web/src/styles/global.css`. Components come from `shared/ui`. Use tokens, not hex values. Check both themes.
- `docker compose up` and the prod compose must both work from a fresh clone with no hand-editing.
- Verification commands: `npm run typecheck` (every workspace), `npm test` (unit + HTTP, no services), `INTEGRATION=1 npm run -w apps/api test` (adds acceptance + AWS contract tests, needs the stack up).

---

## A note on task sizing

Task 3 is deliberately large and lands as one commit. Removing a tenancy parameter from every
service and repository signature is a single atomic type-level change: TypeScript will not compile
any intermediate state, so there is no honest place to cut it into separately-testable pieces. Its
steps are grouped by layer so it can still be worked and reviewed incrementally. Tasks 1, 2, 4, and
5 are genuinely independent.

---

### Task 1: Replace LocalStack with floci

LocalStack's community edition was archived in March 2026 — it now requires an auth token and gets
no security updates. floci is MIT-licensed and deliberately drop-in: same port 4566, same
`/_localstack/health` path, unchanged AWS SDK calls. No application code changes.

**Files:**
- Modify: `docker-compose.yml:47-61`
- Modify: `.github/workflows/ci.yml:43`
- Modify: `.env.example:41-43`
- Modify: `apps/api/test/support/stack-env.ts:15`
- Modify: `README.md`, `PLAN.md`, `CLAUDE.md`, `docs/security.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a compose service named `floci` on the `aws` profile, reachable at `http://floci:4566` from containers and `http://localhost:4566` from the host.

- [ ] **Step 1: Swap the compose service**

Replace the `localstack` service block in `docker-compose.yml` with:

```yaml
  # AWS stand-in. LocalStack's community edition was archived in March 2026; floci is the
  # MIT-licensed drop-in — same port, same endpoint, unchanged SDK calls.
  # Opt in with: docker compose --profile aws up -d floci
  floci:
    image: floci/floci:1.5.11
    profiles: ["aws"]
    environment:
      # In-memory: a test run should never inherit secrets from the previous one.
      FLOCI_STORAGE_MODE: memory
    ports: ["4566:4566"]
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:4566/_localstack/health"]
      interval: 5s
      timeout: 5s
      retries: 30
      start_period: 20s
```

The healthcheck no longer greps for LocalStack's exact `"secretsmanager": "available"` JSON —
floci serves the path for compatibility but does not promise to reproduce the body byte for byte.

- [ ] **Step 2: Point the host-rewrite helper at the new container name**

In `apps/api/test/support/stack-env.ts:15`:

```ts
const CONTAINER_HOSTS = ['postgres', 'redis', 'litellm', 'floci'];
```

- [ ] **Step 3: Update CI**

In `.github/workflows/ci.yml:43`:

```yaml
          docker compose --profile aws up -d --wait floci
```

- [ ] **Step 4: Update the env template and docs**

In `.env.example:41-43`:

```
# To exercise the AWS path locally:  docker compose --profile aws up -d floci
#   SECRETS_BACKEND=aws
#   AWS_ENDPOINT_URL=http://floci:4566   (http://localhost:4566 from the host)
```

Then replace every remaining `localstack` mention with `floci` across `README.md`, `PLAN.md`,
`CLAUDE.md`, and `docs/security.md`:

```bash
grep -rln 'localstack\|LocalStack' README.md PLAN.md CLAUDE.md docs/security.md \
  | xargs sed -i '' -e 's/localstack/floci/g' -e 's/LocalStack/floci/g'
```

Then read each hit back and fix any sentence the substitution made ungrammatical — `CLAUDE.md`'s
command block says `docker compose --profile aws up -d localstack   # AWS stand-in for the
Secrets Manager path`, which must end up naming the `floci` service.

- [ ] **Step 5: Verify the AWS secret-store contract still passes against floci**

```bash
docker compose up -d --wait
docker compose --profile aws up -d --wait floci
INTEGRATION=1 npm run -w apps/api test
```

Expected: PASS, including `apps/api/test/integration/secret-store.test.ts`. That test exercises
`AwsSecretStore` put/get/delete against the emulator, so a green run is the real proof floci is a
working substitute.

- [ ] **Step 6: Confirm no LocalStack references survive**

```bash
grep -rin 'localstack' --exclude-dir=node_modules --exclude-dir=.git .
```

Expected: only the `/_localstack/health` healthcheck URL in `docker-compose.yml` (floci's own
compatibility path) and any historical mention inside `docs/superpowers/`.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml .github/workflows/ci.yml .env.example \
  apps/api/test/support/stack-env.ts README.md PLAN.md CLAUDE.md docs/security.md
git commit -m "Replace the archived LocalStack with floci"
```

---

### Task 2: Verify instance-wide usage before building on it

The spec replaces `organizationUsage` with an unfiltered `GET /user/daily/activity` under the
master key. That is the one unverified assumption in the design, and the entire usage dashboard
rests on it. Find out now, not after Task 3.

`GET /gateway/daily/activity` has already been ruled out: it returns
`GatewayRequestActivityResponse`, which breaks requests down by route and carries no spend, model,
or provider dimension.

**Files:**
- Create: none (this task produces an answer, and a note appended to the spec)
- Modify: `docs/superpowers/specs/2026-08-22-single-tenant-and-floci-design.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a confirmed or refuted assumption for Task 3's `instanceUsage(from, to)`.

- [ ] **Step 1: Bring up the stack and generate real spend**

```bash
docker compose up -d --wait
INTEGRATION=1 npm run -w apps/api test
```

The acceptance test in `apps/api/test/integration/acceptance.test.ts` onboards a provider, issues
a key, and makes a real call — so after it runs, LiteLLM has at least one priced request recorded
against at least one user.

- [ ] **Step 2: Call the endpoint with no user_id**

```bash
MASTER_KEY=$(grep '^LITELLM_MASTER_KEY=' .env | cut -d= -f2-)
curl -s -H "Authorization: Bearer ${MASTER_KEY}" \
  "http://localhost:4000/user/daily/activity?start_date=2026-01-01&end_date=2026-12-31&page_size=100" \
  | python3 -m json.tool | head -60
```

- [ ] **Step 3: Judge the result**

The assumption **holds** if the response has a non-empty `results` array whose day entries carry
`metrics.spend` and a `breakdown` object containing `models` and `providers` keys — that is the
`SpendAnalyticsPaginatedResponse` shape `toUsageReport` already parses in
`apps/api/src/infra/litellm/litellm-gateway.ts:250-278`.

The assumption **fails** if `results` is empty, or if the call returns 4xx demanding a `user_id`.

- [ ] **Step 4: Record the answer in the spec**

If it holds, append to the `instanceUsage` paragraph of the spec: `Verified against LiteLLM
v1.97.0 on 2026-08-22: an unfiltered call under the master key returns instance-wide results.`
and proceed to Task 3 unchanged.

If it fails, **stop and report**. Do not improvise. The spec names the fallback — keep a single
LiteLLM-side organization purely as a spend rollup bucket, invisible to our schema and our API —
but adopting it changes `LlmGateway`, `container.ts`, and `UsageService` in ways this plan does
not describe, and it needs a design decision before code.

- [ ] **Step 5: Commit the spec note**

```bash
git add docs/superpowers/specs/2026-08-22-single-tenant-and-floci-design.md
git commit -m "Record that instance-wide usage is verified against LiteLLM v1.97.0"
```

---

### Task 3: Remove organizations

One atomic commit, for the reason given under "A note on task sizing". Work the steps in order:
each layer compiles against the one below it, so going bottom-up keeps the error list shrinking
rather than churning.

**Files:**
- Delete: `apps/api/src/modules/organizations/organization.service.ts`, `organization.controller.ts`, `organization.repository.ts`, `membership.repository.ts`
- Move: `apps/api/src/modules/organizations/user.repository.ts` → `apps/api/src/modules/users/user.repository.ts`
- Move: `apps/api/src/modules/organizations/slug.ts` → `apps/api/src/core/slug.ts`
- Create: `apps/api/src/modules/users/user.service.ts`, `apps/api/src/modules/audit/audit.controller.ts`
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/src/core/unit-of-work.ts`, `apps/api/src/core/gateway.ts`, `apps/api/src/infra/secrets/secret-store.ts`, `apps/api/src/infra/litellm/litellm-gateway.ts`, `apps/api/src/infra/db/prisma-unit-of-work.ts`, `apps/api/src/container.ts`, `apps/api/src/http/server.ts`, `apps/api/src/http/plugins/auth.ts`, every file under `apps/api/src/modules/`, `packages/shared/src/contracts/auth.ts`, `packages/shared/src/contracts/model.ts`, and the web files listed in Step 10
- Test: `apps/api/test/support/fakes.ts`, `apps/api/test/unit/key.service.test.ts`, `apps/api/test/unit/security.test.ts`, `apps/api/test/http/server.test.ts`, `apps/api/test/integration/acceptance.test.ts`

**Interfaces:**
- Consumes: Task 2's verified `GET /user/daily/activity` behaviour.
- Produces, for Task 4:
  - `AuthContext = { userId: string; role: Role; ip: string | null }`
  - `Session = { userId: string }`
  - `TeamRepository.findInstance` naming: `list()`, `findById(id)`, `listForUser(userId)`, `create({ name, slug, litellmTeamId })`
  - `TeamService` methods: `list()`, `get(id)`, `create(context, request)`, `delete(context, id)`, `addMember(context, teamId, userId)`, `removeMember(context, teamId, userId)`, `setModelAccess(context, teamId, modelIds)`
  - `UserService.ensureGatewayUser(userId: string): Promise<string>`
  - `slugify(value: string): string` from `apps/api/src/core/slug.ts`

- [ ] **Step 1: Rewrite the Prisma schema**

Replace `apps/api/prisma/schema.prisma` with:

```prisma
// Control-plane data only.
// Never here: provider API keys, plaintext gateway keys, anything from LiteLLM's schema.
// Single-tenant: one deployment is one organization, and that organization is implicit.

generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

// Prisma 7: the connection URL lives in prisma.config.ts (CLI) and in the
// driver adapter passed to PrismaClient (runtime).
datasource db {
  provider = "postgresql"
}

/// Instance-wide authority.
enum Role {
  OWNER
  ADMIN
  MEMBER
}

/// Authority within one team. A LEAD manages that team's members and model access, nothing else.
enum TeamRole {
  MEMBER
  LEAD
}

enum UserStatus {
  ACTIVE
  DISABLED
}

enum ProviderType {
  AZURE_OPENAI
  OPENAI
  ANTHROPIC
}

enum ProviderStatus {
  ACTIVE
  DISABLED
}

enum KeyStatus {
  ACTIVE
  REVOKED
  ROTATED
}

enum BudgetPeriod {
  DAILY
  MONTHLY
}

model User {
  id           String     @id @default(uuid())
  email        String     @unique
  name         String
  /// argon2id. Null once an external identity provider owns the credential.
  passwordHash String?
  role         Role       @default(MEMBER)
  status       UserStatus @default(ACTIVE)
  /// Mirrored LiteLLM internal user, so per-developer spend comes from /user/daily/activity.
  litellmUserId String?   @unique
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  teamMembers TeamMember[]
  modelAccess ModelAccess[]
  keys        GatewayKeyReference[]
  budgets     Budget[]
}

model Team {
  id            String   @id @default(uuid())
  name          String
  slug          String   @unique
  litellmTeamId String?  @unique
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  members     TeamMember[]
  modelAccess ModelAccess[]
  keys        GatewayKeyReference[]
  budgets     Budget[]
}

model TeamMember {
  id        String   @id @default(uuid())
  teamId    String
  userId    String
  role      TeamRole @default(MEMBER)
  createdAt DateTime @default(now())

  team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([teamId, userId])
  @@index([userId])
}

model Provider {
  id     String         @id @default(uuid())
  name   String         @unique
  /// Namespaces this provider's models in the gateway: "{slug}/{publicModelName}".
  /// Derived from the name at creation and never changed — renaming would orphan every
  /// registered model name and every key alias pointing at it.
  slug   String         @unique
  type   ProviderType
  status ProviderStatus @default(ACTIVE)
  /// Secrets Manager ARN or env:// URI. NEVER the credential itself.
  secretRef String
  /// Non-secret config only: apiBase, apiVersion.
  config    Json         @default("{}")
  /// Reusable LiteLLM credential the models point at via litellm_credential_name.
  litellmCredentialName String? @unique
  lastTestedAt  DateTime?
  lastTestError String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  models ProviderModel[]
}

model ProviderModel {
  id                String   @id @default(uuid())
  providerId        String
  /// What developers type: "gpt-5".
  publicModelName   String
  /// What LiteLLM calls upstream: "azure/my-gpt5-deployment".
  providerModelName String
  /// Globally unique: "{providerSlug}/{publicModelName}". Keys alias it back to the short name.
  litellmModelName  String   @unique
  /// model_info.id returned by POST /model/new.
  litellmModelId    String?  @unique
  enabled           Boolean  @default(true)
  metadata          Json     @default("{}")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  provider    Provider      @relation(fields: [providerId], references: [id], onDelete: Cascade)
  modelAccess ModelAccess[]

  @@unique([providerId, publicModelName])
}

/// Absence of a row means denied. Exactly one of userId / teamId is set.
model ModelAccess {
  id              String   @id @default(uuid())
  userId          String?
  teamId          String?
  providerModelId String
  createdAt       DateTime @default(now())

  user          User?         @relation(fields: [userId], references: [id], onDelete: Cascade)
  team          Team?         @relation(fields: [teamId], references: [id], onDelete: Cascade)
  providerModel ProviderModel @relation(fields: [providerModelId], references: [id], onDelete: Cascade)

  @@unique([userId, teamId, providerModelId])
}

/// Reference to a LiteLLM virtual key. The key itself is shown once and never stored.
model GatewayKeyReference {
  id     String  @id @default(uuid())
  userId String?
  teamId String?
  /// Our handle into LiteLLM: revoke and rotate go through key_alias, not the secret.
  keyAlias     String    @unique
  /// LiteLLM token_id (the hashed token).
  litellmKeyId String
  /// Masked display value only, e.g. "sk-...AbCd".
  keyPrefix    String?
  status       KeyStatus @default(ACTIVE)
  expiresAt    DateTime?
  revokedAt    DateTime?
  createdAt    DateTime  @default(now())

  user User? @relation(fields: [userId], references: [id], onDelete: Cascade)
  team Team? @relation(fields: [teamId], references: [id], onDelete: Cascade)

  @@index([status])
}

model Budget {
  id        String       @id @default(uuid())
  userId    String?
  teamId    String?
  maxBudget Decimal      @db.Decimal(12, 4)
  period    BudgetPeriod
  rpmLimit  Int?
  tpmLimit  Int?
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  user User? @relation(fields: [userId], references: [id], onDelete: Cascade)
  team Team? @relation(fields: [teamId], references: [id], onDelete: Cascade)

  @@unique([userId, teamId])
}

model AuditLog {
  id          String   @id @default(uuid())
  actorUserId String?
  action      String
  targetType  String
  targetId    String
  /// Redacted by the writer. Never contains a secret.
  metadata    Json     @default("{}")
  ip          String?
  createdAt   DateTime @default(now())

  @@index([createdAt])
}
```

- [ ] **Step 2: Squash the migration**

The spec chose a clean break, and there is exactly one migration today, so replace it rather than
adding a second:

```bash
rm -rf apps/api/prisma/migrations/20260819205310_init
docker compose down -v          # drops the volume, so the fresh init applies to an empty database
docker compose up -d --wait postgres
docker compose exec api npm run -w apps/api prisma -- migrate dev --name init
```

Expected: a new `apps/api/prisma/migrations/<timestamp>_init/migration.sql`, and a regenerated
client under `apps/api/src/generated/prisma/` in which `models/Organization.ts` and
`models/Membership.ts` no longer exist.

- [ ] **Step 3: Move the shared helpers**

```bash
git mv apps/api/src/modules/organizations/slug.ts apps/api/src/core/slug.ts
mkdir -p apps/api/src/modules/users
git mv apps/api/src/modules/organizations/user.repository.ts apps/api/src/modules/users/user.repository.ts
git rm apps/api/src/modules/organizations/organization.service.ts \
       apps/api/src/modules/organizations/organization.controller.ts \
       apps/api/src/modules/organizations/organization.repository.ts \
       apps/api/src/modules/organizations/membership.repository.ts
```

In `apps/api/src/core/slug.ts`, change the fallback — `'org'` is no longer a sensible default for
a value that now names providers and teams:

```ts
/**
 * Slugs are used as gateway namespaces and appear in model names, so they are restricted to
 * lowercase alphanumerics and single dashes.
 */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'unnamed';
}
```

- [ ] **Step 4: Update the shared wire contract**

In `packages/shared/src/contracts/common.ts`, add below `roleSchema`:

```ts
/** Authority within one team, independent of the instance-wide Role above. */
export const teamRoleSchema = z.enum(['MEMBER', 'LEAD']);
export type TeamRole = z.infer<typeof teamRoleSchema>;
```

In `packages/shared/src/contracts/auth.ts`: delete `organizationSummarySchema` and its type, drop
`organizationName` from `registerRequestSchema`, and reduce `meResponseSchema` to:

```ts
export const meResponseSchema = z.object({
  user: sessionUserSchema,
  role: roleSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;
```

In `packages/shared/src/contracts/model.ts`, remove the organization reference (it is a single
mention; check with `grep -n organization packages/shared/src/contracts/model.ts`).

- [ ] **Step 5: Update core ports**

`apps/api/src/core/unit-of-work.ts` — drop `organizations` and `memberships` from `Repositories`,
and re-point the `UserRepository` import at `../modules/users/user.repository.js`.

`apps/api/src/core/gateway.ts` — delete `createOrganization`; drop the `organizationId` parameter
from `createUser` and `createTeam`; replace `organizationUsage` with `instanceUsage`:

```ts
  createUser(email: string): Promise<string>;
  createTeam(name: string): Promise<string>;
  addTeamMember(teamId: string, userId: string): Promise<void>;

  /** Spend across the whole deployment. Single-tenant: there is nothing narrower to scope to. */
  instanceUsage(from: string, to: string): Promise<UsageReport>;
  userUsage(userId: string, from: string, to: string): Promise<UsageReport>;
```

`apps/api/src/infra/secrets/secret-store.ts`:

```ts
export function secretReference(deployEnv: string, providerId: string): string {
  return `gatehouse/${deployEnv}/providers/${providerId}`;
}
```

Also drop the LocalStack sentence from the `AwsSecretStore` doc comment if Task 1's sed did not
already rewrite it — it should now read "runs against floci".

- [ ] **Step 6: Update the LiteLLM adapter**

In `apps/api/src/infra/litellm/litellm-gateway.ts`: delete `createOrganization`, drop the
`organizationId` argument and its spread from `createUser` and `createTeam`, and replace
`organizationUsage` with:

```ts
  async instanceUsage(from: string, to: string): Promise<UsageReport> {
    // No user_id: under the master key this returns every user's activity, which in a
    // single-tenant deployment is the whole instance. /gateway/daily/activity looks like the
    // better fit by name but reports request counts by route, with no spend dimension.
    const query = new URLSearchParams({ start_date: from, end_date: to, page_size: '100' });
    return toUsageReport(await this.call<wire.DailyActivityResponse>('GET', `/user/daily/activity?${query}`));
  }
```

`toUsageReport` is unchanged — the response shape is the same `SpendAnalyticsPaginatedResponse`.

Update the `toKeyPayload` doc comment: its final sentence currently reads "Safe only because every
model this control plane registers is namespaced by organization slug." Change `organization slug`
to `provider slug`. The reasoning still holds; only the namespace changed.

- [ ] **Step 7: Update the repositories**

Every repository drops its `organizationId` parameters and any `organizationId` in its `SELECT`
and `where` clauses. Rename the methods whose names encode tenancy:

| Repository | Before | After |
|---|---|---|
| `teams` | `listByOrganization(orgId)` | `list()` |
| `teams` | `findInOrganization(id, orgId)` | `findById(id)` |
| `teams` | `listForUser(orgId, userId)` | `listForUser(userId)` |
| `models` | `listByOrganization(orgId)` | `list()` |
| `models` | `findManyInOrganization(ids, orgId)` | `findMany(ids)` |
| `models` | `countEnabled(orgId)` | `countEnabled()` |
| `providers` | `listByOrganization(orgId)` | `list()` |
| `modelAccess` | `listEffectiveForUser(orgId, userId)` | `listEffectiveForUser(userId)` |
| `keys` | `countActiveByUser(orgId)` | `countActiveByUser()` |
| `budgets` | `findForUser(orgId, userId)` | `findForUser(userId)` |

In `apps/api/src/modules/users/user.repository.ts`, add `role` to the domain type, the `SELECT`,
and `create`, and add the two methods that `MembershipRepository` used to own:

```ts
import type { Role, UserStatus } from '@gatehouse/shared';

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
};

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmailWithSecret(email: string): Promise<UserWithSecret | null>;
  countAll(): Promise<number>;
  list(): Promise<User[]>;
  create(input: { email: string; name: string; passwordHash: string | null; role: Role }): Promise<User>;
  setStatus(id: string, status: UserStatus): Promise<void>;
  setRole(id: string, role: Role): Promise<void>;
  delete(id: string): Promise<void>;
  /** The mirrored LiteLLM user, or null until one is created. */
  findLitellmUserId(id: string): Promise<string | null>;
  setLitellmUserId(id: string, litellmUserId: string): Promise<void>;
}

const SELECT = { id: true, email: true, name: true, role: true, status: true } as const;
```

Delete `findOrCreateByEmail`: it existed only because one person could belong to several
organizations. With one instance, a duplicate email is a `ConflictError`, not an upsert.

In `apps/api/src/modules/teams/team.repository.ts`, drop `organizationId` from the `Team` type,
`SELECT`, and `create`.

- [ ] **Step 8: Update auth**

`apps/api/src/modules/auth/session.store.ts`:

```ts
/** What a signed-in caller is. Single-tenant, so identity is the whole of it. */
export type Session = {
  userId: string;
};
```

`apps/api/src/modules/auth/authenticator.ts`:

```ts
/**
 * The authenticated caller. `userId` and `role` originate here, from the session and the user
 * row — never from a request body or query — which is what keeps authorization enforceable in
 * one place.
 */
export type AuthContext = {
  userId: string;
  role: Role;
  ip: string | null;
};

// ...

  async authenticate(sessionId: string | undefined, ip: string | null): Promise<AuthContext> {
    if (!sessionId) throw new UnauthorizedError();

    const session = await this.sessions.read(sessionId);
    if (!session) throw new UnauthorizedError('Session expired');

    // Re-read the user on every request: a revoked role or a disabled account must take effect
    // immediately, not whenever the session happens to expire.
    const user = await this.uow.repos.users.findById(session.userId);
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedError();

    return { userId: user.id, role: user.role, ip };
  }
```

`apps/api/src/modules/auth/auth.service.ts` — `SignedIn` becomes `{ sessionId: string; user: SessionUser }`. `signIn` drops the membership lookup and its `ForbiddenError`. `register` drops `reserveSlug`, the organization creation, and the membership creation, and instead creates the user with `role: 'OWNER'`. `describe` returns `{ user, role }`. Update the `auth.controller.ts` call sites and the `plugins/auth.ts` doc comment about tenancy.

- [ ] **Step 9: Update the services**

Delete `OrganizationService`. Create `apps/api/src/modules/users/user.service.ts` holding the half
that survives:

```ts
import { NotFoundError } from '../../core/errors.js';
import type { LlmGateway } from '../../core/gateway.js';
import type { UnitOfWork } from '../../core/unit-of-work.js';

export class UserService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly gateway: LlmGateway,
  ) {}

  /** The gateway-side user, created on first use so the mirror stays lazy. */
  async ensureGatewayUser(userId: string): Promise<string> {
    const existing = await this.uow.repos.users.findLitellmUserId(userId);
    if (existing) return existing;

    const user = await this.uow.repos.users.findById(userId);
    if (!user) throw new NotFoundError('Developer');

    const gatewayUserId = await this.gateway.createUser(user.email);
    await this.uow.repos.users.setLitellmUserId(userId, gatewayUserId);
    return gatewayUserId;
  }
}
```

`ensureGatewayOrganization` is deleted outright — `createTeam` and `createUser` no longer take one.

Then, across `access.service.ts`, `developer.service.ts`, `key.service.ts`, `model.service.ts`,
`provider.service.ts`, `team.service.ts`, `usage.service.ts`, `audit.service.ts`: drop every
`organizationId` parameter and `context.organizationId` argument, and swap the
`OrganizationService` constructor dependency for `UserService`.

Three changes in that sweep are more than mechanical:

`access.service.ts` — `requireMembership` becomes `requireUser`:

```ts
  async requireUser(userId: string) {
    const user = await this.uow.repos.users.findById(userId);
    if (!user) throw new NotFoundError('Developer');
    return user;
  }
```

`model.service.ts:39-49` — the namespace becomes the provider slug:

```ts
    // Namespaced per provider so two providers can both publish "gpt-5" — an Azure one and a
    // direct-OpenAI one during a migration. Keys carry an alias so developers keep typing "gpt-5".
    const gatewayModelName = `${provider.slug}/${request.publicModelName}`;

    const gatewayModelId = await this.gateway.registerModel(
      gatewayModelName,
      {
        ...adapterFor(provider.type).modelParams(request.providerModelName),
        litellm_credential_name: provider.litellmCredentialName,
      },
      { provider_id: provider.id, provider: provider.slug },
    );
```

`provider.service.ts:65-75` — the slug is derived at creation, and both the secret reference and
the credential name lose the org:

```ts
    const providerId = randomUUID();
    const slug = slugify(request.name);
    const reference = secretReference(this.config.deployEnv, providerId);
    // The id is retained so deleting and recreating a provider under the same name cannot
    // collide with the credential the old one left behind in the gateway.
    const credentialName = `${slug}__${providerId}`;

    await this.secrets.put(reference, credentials);
    try {
      await this.gateway.putCredential(credentialName, adapter.credentialValues(credentials, config), {
        provider: request.name,
      });
```

Persist `slug` alongside `name` in the `repos.providers.create` call inside the transaction that
follows.

`developer.service.ts` — `create` calls `repos.users.create({ ..., role: request.role })` and
throws `ConflictError('A developer with this email already exists')` on a duplicate rather than
consulting memberships; `update` calls `repos.users.setRole(userId, request.role)`; `remove`
calls `repos.users.delete(userId)`. Note that removing a developer now deletes the `User` row —
previously it deleted a membership and left the account behind for other organizations, which no
longer means anything. The cascade takes their keys, budgets, model access, and team memberships
with it, and `keys.revokeAllForUser` still runs first so the gateway-side keys are revoked rather
than orphaned.

`usage.service.ts` — `organizationReport` becomes `instanceReport`, calling
`this.gateway.instanceUsage(from, to)`; cache keys drop the organization segment
(`usage:totals:${from}:${to}`); `repos.memberships.countByOrganization` becomes
`repos.users.countAll`; `repos.memberships.listMirrored` becomes a new
`repos.users.listMirrored(): Promise<Array<{ id: string; litellmUserId: string }>>` returning
users whose `litellmUserId` is non-null.

- [ ] **Step 10: Update HTTP wiring and the web app**

Create `apps/api/src/modules/audit/audit.controller.ts` holding the `/audit-logs` route lifted
verbatim from `organization.controller.ts:27`, minus its `organizationId` argument. In
`apps/api/src/http/server.ts`, replace `organizationController` with `auditController` in both the
import list and the controller array.

In `apps/api/src/container.ts`, drop `organizations` from `Services` and construct `users: new
UserService(uow, gateway)` in its place, threading it into `AccessService`, `TeamService`, and
`UsageService`.

Then the web app:
- `apps/web/src/app/DashboardLayout.tsx:22,31-32` — remove the `organization` lookup, the
  `crumb-org` span's organization name (leave the literal `Gatehouse`), and the `crumb-badge` slug.
- `apps/web/src/features/settings/SettingsPage.tsx:11-35` — delete the whole `Organization`
  `<Section>` and the `organization` lookup above it; reword the page description, which currently
  reads "Organization, account, and the health of the services behind the gateway."
- `apps/web/src/features/auth/LoginPage.tsx:85,96-97` — delete the `Organization` `<Field>` and
  change the subtitle to "This creates the owner account. Sign-up closes afterwards."
- `apps/web/src/features/models/ModelsPage.tsx` — the namespacing copy now describes provider
  slugs rather than organization slugs.
- `apps/web/src/shared/api/query-keys.ts` and `apps/web/src/features/*/queries.ts` — remove any
  organization query key or `useSwitchOrganization` mutation left pointing at the deleted routes.

- [ ] **Step 11: Update the tests**

`apps/api/test/support/fakes.ts` — drop `organizations` and `memberships` from
`stubRepositories`; in `fakeGateway`, delete the `createOrganization` line and rename
`organizationUsage` to `instanceUsage`.

`apps/api/test/unit/security.test.ts:45` — the audit context literal becomes
`{ userId: 'user-1', ip: null }`. Nothing else in that file changes; it tests password hashing,
audit scrubbing, and the SSRF host guard, none of which touch tenancy.

`apps/api/test/unit/key.service.test.ts`, `apps/api/test/http/server.test.ts`,
`apps/api/test/integration/acceptance.test.ts` — drop `organizationId` from every fake
`AuthContext`, session, and service call. In the acceptance test, remove the organization
assertions from the registration flow and add one asserting instance usage is reachable after a
real call:

```ts
  const usage = await api.get('/api/usage/totals');
  assert.equal(usage.status, 200);
  assert.ok(usage.body.requests >= 1, 'a real gateway call must show up in instance usage');
```

- [ ] **Step 12: Typecheck**

```bash
npm run typecheck
```

Expected: PASS across every workspace. This is the real gate for this task — the type system is
what proves no `organizationId` survives. If errors remain, they name the exact files still
carrying the parameter; work through them before moving on.

- [ ] **Step 13: Run the unit and HTTP tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 14: Run the acceptance flow against a fresh stack**

```bash
docker compose down -v
docker compose up -d --wait
INTEGRATION=1 npm run -w apps/api test
```

Expected: PASS. `down -v` matters — it proves the squashed migration applies to an empty database,
which is exactly what a fresh fork will do.

- [ ] **Step 15: Confirm the concept is gone**

```bash
grep -rin 'organizationid\|membership' apps packages --include='*.ts' --include='*.tsx' \
  | grep -v 'src/generated'
```

Expected: no output.

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "Remove the organization tenancy layer

Gatehouse is self-hosted by a single organization, so the tenancy boundary
modelled nothing any deployment crossed while taxing every layer. Models are
now namespaced by provider slug, and instance usage comes from an unfiltered
/user/daily/activity."
```

---

### Task 4: Team leads

Additive on the clean single-tenant base. A `LEAD` manages their own team's membership and model
access, and gains nothing over providers, other teams, keys, or budgets. A lead may never write or
delete a membership row that currently holds `LEAD` — see the correction note in Step 4, which
records why the obvious "refuse role === 'LEAD'" guard is not enough.

The check lives in `TeamService`, not in a route guard: "is this caller a lead of *this* team" is
a database read, and controllers do not branch on domain state. `AuthContext` is deliberately not
extended — leadership is per-team, so it costs one lookup on mutating paths rather than a lookup
on every authenticated request.

**Files:**
- Modify: `packages/shared/src/contracts/team.ts`
- Modify: `apps/api/src/modules/teams/team.repository.ts`
- Modify: `apps/api/src/modules/teams/team.service.ts`
- Modify: `apps/api/src/modules/teams/team.controller.ts`
- Modify: `apps/web/src/features/teams/TeamsPage.tsx`, `apps/web/src/features/teams/queries.ts`
- Test: `apps/api/test/unit/team-access.test.ts` (create)

**Interfaces:**
- Consumes: `TeamService`, `TeamRepository`, and `AuthContext` as produced by Task 3.
- Produces: `TeamRepository.findMember(teamId, userId): Promise<{ userId: string; role: TeamRole } | null>` and `TeamRepository.addMember(teamId, userId, role)`.

The `TeamRole` enum and the `TeamMember.role` column already landed in Task 3's schema, so no
migration is needed here.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/unit/team-access.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenError } from '../../src/core/errors.js';
import type { AuditService } from '../../src/modules/audit/audit.service.js';
import type { AuthContext } from '../../src/modules/auth/authenticator.js';
import type { AccessService } from '../../src/modules/developers/access.service.js';
import type { TeamRepository } from '../../src/modules/teams/team.repository.js';
import { TeamService } from '../../src/modules/teams/team.service.js';
import type { UserService } from '../../src/modules/users/user.service.js';
import { autoStub, fakeGateway, fakeUnitOfWork, stubRepositories } from '../support/fakes.js';

/**
 * The team-lead boundary. A lead runs their own team and nothing else, so every assertion here
 * is about what a lead may NOT reach.
 */

const lead: AuthContext = { userId: 'user-lead', role: 'MEMBER', ip: null };
const plain: AuthContext = { userId: 'user-plain', role: 'MEMBER', ip: null };
const admin: AuthContext = { userId: 'user-admin', role: 'ADMIN', ip: null };

/**
 * Both halves matter: refusals must be the domain `ForbiddenError` (a plain Error with the same
 * wording would leave `http/error-handler.ts` mapping it to a 500), and the message identifies
 * *which* rule refused, so one guard cannot masquerade as another.
 */
const forbidden = (message: RegExp) => (error: unknown) => {
  assert.ok(error instanceof ForbiddenError, `expected ForbiddenError, got ${String(error)}`);
  assert.match(error.message, message);
  return true;
};

/** Team A is led by user-lead and has user-plain as a rank-and-file member. Team B has no leads. */
function serviceWith(overrides: Partial<TeamRepository> = {}) {
  const teams = autoStub<TeamRepository>('teams', {
    findById: async (id: string) =>
      id === 'team-a' || id === 'team-b'
        ? { id, name: id, slug: id, litellmTeamId: null }
        : null,
    findMember: async (teamId: string, userId: string) => {
      if (teamId !== 'team-a') return null;
      if (userId === 'user-lead') return { userId, role: 'LEAD' as const };
      if (userId === 'user-plain') return { userId, role: 'MEMBER' as const };
      return null;
    },
    ...overrides,
  });
  const repos = stubRepositories({ teams });
  return new TeamService(
    fakeUnitOfWork(repos),
    fakeGateway(),
    autoStub<UserService>('users', {}),
    // The happy-path test runs past the guards into these two; the refusal tests never reach
    // them, and autoStub throws on anything else either way.
    autoStub<AccessService>('access', {
      requireUser: async (id: string) => ({
        id,
        email: `${id}@example.com`,
        name: id,
        role: 'MEMBER' as const,
        status: 'ACTIVE' as const,
      }),
      syncActiveKeys: async () => {},
    }),
    autoStub<AuditService>('audit', { record: async () => {} }),
  );
}

test('a lead is refused on a team they do not lead', async () => {
  await assert.rejects(
    () => serviceWith().addMember(lead, 'team-b', 'user-x'),
    forbidden(/do not lead this team/i),
  );
});

test('a lead is refused on another team’s model access', async () => {
  await assert.rejects(
    () => serviceWith().setModelAccess(lead, 'team-b', ['model-1']),
    forbidden(/do not lead this team/i),
  );
});

test('a lead cannot appoint another lead', async () => {
  await assert.rejects(
    () => serviceWith().addMember(lead, 'team-a', 'user-x', 'LEAD'),
    forbidden(/only an admin can appoint a team lead/i),
  );
});

test('a lead cannot remove an existing lead', async () => {
  const service = serviceWith({
    findMember: async (teamId: string, userId: string) =>
      teamId === 'team-a' && (userId === 'user-lead' || userId === 'user-other')
        ? { userId, role: 'LEAD' as const }
        : null,
  });
  await assert.rejects(
    () => service.removeMember(lead, 'team-a', 'user-other'),
    forbidden(/only an admin can remove a team lead/i),
  );
});

test('an admin may appoint a lead on any team', async () => {
  const added: unknown[] = [];
  const service = serviceWith({
    addMember: async (...args: unknown[]) => {
      added.push(args);
    },
  });
  await service.addMember(admin, 'team-b', 'user-x', 'LEAD');
  assert.deepEqual(added, [['team-b', 'user-x', 'LEAD']]);
});

/** A team with two leads: user-lead (the caller) and user-other (the peer). */
function serviceWithPeerLead(added: unknown[]) {
  return serviceWith({
    findMember: async (teamId: string, userId: string) =>
      teamId === 'team-a' && (userId === 'user-lead' || userId === 'user-other')
        ? { userId, role: 'LEAD' as const }
        : null,
    addMember: async (...args: unknown[]) => {
      added.push(args);
    },
    removeMember: async (...args: unknown[]) => {
      added.push(args);
    },
  });
}

test('a lead cannot demote a peer lead by re-adding them as a member', async () => {
  // The upsert overwrites the stored role, so without a guard this demotes the peer and the
  // "only an admin can remove a team lead" rule falls in two calls.
  const added: unknown[] = [];
  await assert.rejects(
    () => serviceWithPeerLead(added).addMember(lead, 'team-a', 'user-other', 'MEMBER'),
    forbidden(/only an admin can change a team lead/i),
  );
  assert.deepEqual(added, [], 'the refusal must happen before any write');
});

test('an admin may still demote a lead', async () => {
  const added: unknown[] = [];
  await serviceWithPeerLead(added).addMember(admin, 'team-a', 'user-other', 'MEMBER');
  assert.deepEqual(added, [['team-a', 'user-other', 'MEMBER']]);
});

test('a plain team member is refused on every managed path', async () => {
  const added: unknown[] = [];
  const service = serviceWith({
    addMember: async (...args: unknown[]) => {
      added.push(args);
    },
    removeMember: async (...args: unknown[]) => {
      added.push(args);
    },
  });
  // Belonging to a team is not leading it: the guard must reject role MEMBER, not merely null.
  await assert.rejects(
    () => service.addMember(plain, 'team-a', 'user-x'),
    forbidden(/do not lead this team/i),
  );
  await assert.rejects(
    () => service.removeMember(plain, 'team-a', 'user-lead'),
    forbidden(/do not lead this team/i),
  );
  await assert.rejects(
    () => service.setModelAccess(plain, 'team-a', ['model-1']),
    forbidden(/do not lead this team/i),
  );
  assert.deepEqual(added, []);
});

test('a lead may add an ordinary member to their own team', async () => {
  const added: unknown[] = [];
  const service = serviceWith({
    addMember: async (...args: unknown[]) => {
      added.push(args);
    },
  });
  await service.addMember(lead, 'team-a', 'user-x');
  assert.deepEqual(added, [['team-a', 'user-x', 'MEMBER']]);
});
```

The `users`, `access`, and `audit` stubs above deliberately implement nothing: `autoStub` throws
on any unanticipated call, so if a guard is missing, the test fails loudly on the *next* call the
service makes rather than passing by accident.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run -w apps/api test -- --test-name-pattern='lead'`
Expected: FAIL — `findMember` is not a property of `TeamRepository`, and `addMember` takes two
arguments, not three.

- [ ] **Step 3: Extend the repository**

In `apps/api/src/modules/teams/team.repository.ts`:

```ts
import type { TeamRole } from '@gatehouse/shared';

export type TeamMember = { id: string; name: string; email: string; role: TeamRole };

export interface TeamRepository {
  // ...existing methods...
  findMember(teamId: string, userId: string): Promise<{ userId: string; role: TeamRole } | null>;
  addMember(teamId: string, userId: string, role: TeamRole): Promise<void>;
}
```

```ts
  findMember(teamId: string, userId: string): Promise<{ userId: string; role: TeamRole } | null> {
    return this.db.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { userId: true, role: true },
    });
  }

  async listMembers(teamId: string): Promise<TeamMember[]> {
    const rows = await this.db.teamMember.findMany({
      where: { teamId },
      select: { role: true, user: { select: { id: true, name: true, email: true } } },
    });
    return rows.map((row) => ({ ...row.user, role: row.role }));
  }

  async addMember(teamId: string, userId: string, role: TeamRole): Promise<void> {
    await this.db.teamMember.upsert({
      where: { teamId_userId: { teamId, userId } },
      create: { teamId, userId, role },
      update: { role },
    });
  }
```

- [ ] **Step 4: Add the guards to the service**

At the top of `apps/api/src/modules/teams/team.service.ts`:

```ts
import { ForbiddenError, NotFoundError } from '../../core/errors.js';

/** Instance-wide authority. OWNER and ADMIN manage every team; everyone else must lead it. */
function isInstanceAdmin(context: AuthContext): boolean {
  return context.role === 'OWNER' || context.role === 'ADMIN';
}
```

As private methods on `TeamService`:

```ts
  /**
   * Kept here rather than in a route guard: "does this caller lead this team" is a database
   * read, and controllers do not branch on domain state.
   */
  private async assertCanManage(context: AuthContext, teamId: string): Promise<void> {
    if (isInstanceAdmin(context)) return;
    const member = await this.uow.repos.teams.findMember(teamId, context.userId);
    if (member?.role !== 'LEAD') throw new ForbiddenError('You do not lead this team');
  }

  /**
   * A lead's membership row is admin-only whichever way it is written. Without this, a lead
   * could re-POST a peer lead as MEMBER — the upsert would demote them — and then remove them,
   * defeating the appoint/remove rules in two calls.
   */
  private async assertMayTouchLead(
    context: AuthContext,
    teamId: string,
    userId: string,
    verb: 'change' | 'remove',
  ): Promise<void> {
    if (isInstanceAdmin(context)) return;
    const target = await this.uow.repos.teams.findMember(teamId, userId);
    if (target?.role === 'LEAD') throw new ForbiddenError(`Only an admin can ${verb} a team lead`);
  }

  /** Only an admin appoints a lead — otherwise a lead could mint peers without oversight. */
  private assertMayAppoint(context: AuthContext, role: TeamRole): void {
    if (role === 'LEAD' && !isInstanceAdmin(context)) {
      throw new ForbiddenError('Only an admin can appoint a team lead');
    }
  }
```

> **Correction — the original guard here was insecure.** An earlier draft of this plan had
> `assertMayAppoint` as the *only* protection on `addMember`, and it refused just
> `role === 'LEAD'`. Because the repository upsert does `update: { role }`, writing a *lower*
> role onto someone who already was a lead went unguarded: a lead could re-POST a peer lead as
> `MEMBER`, silently demoting them, then remove them — by which point `removeMember`'s inline
> `target?.role === 'LEAD'` check saw an ordinary member. Two calls defeated "only an admin can
> remove a team lead". The fix is `assertMayTouchLead`, keyed on the target row's *existing*
> role and shared by both write paths, rather than a special case for demotion inside
> `assertMayAppoint`. Do not revert this against an older draft.

Then change the three mutating methods. `addMember` gains a `role` parameter, and both guards run
*before* any write or gateway call:

```ts
  async addMember(
    context: AuthContext,
    teamId: string,
    userId: string,
    role: TeamRole = 'MEMBER',
  ): Promise<void> {
    this.assertMayAppoint(context, role);
    await this.assertCanManage(context, teamId);
    // The upsert overwrites an existing row's role, so demotion is a write like any other.
    await this.assertMayTouchLead(context, teamId, userId, 'change');
    const team = await this.require(teamId);
    await this.access.requireUser(userId);

    await this.uow.repos.teams.addMember(team.id, userId, role);
    // ...rest unchanged...
  }

  async removeMember(context: AuthContext, teamId: string, userId: string): Promise<void> {
    await this.assertCanManage(context, teamId);
    // A lead may not remove a peer lead, for the same reason they may not appoint one.
    await this.assertMayTouchLead(context, teamId, userId, 'remove');
    const team = await this.require(teamId);
    // ...rest unchanged...
  }

  async setModelAccess(context: AuthContext, teamId: string, modelIds: string[]) {
    await this.assertCanManage(context, teamId);
    // ...rest unchanged...
  }
```

A lead may grant their team any enabled model in the catalogue — spend is contained by budgets
and observed through the audit log, not by restricting the choice. `create` and `delete` are
untouched and stay admin-only.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run -w apps/api test -- --test-name-pattern='lead'`
Expected: PASS, all nine.

- [ ] **Step 6: Open the routes and carry the role over the wire**

In `packages/shared/src/contracts/team.ts`:

```ts
import { teamRoleSchema, uuidSchema } from './common.js';

export const addTeamMemberRequestSchema = z.object({
  userId: uuidSchema,
  role: teamRoleSchema.default('MEMBER'),
});
export type AddTeamMemberRequest = z.infer<typeof addTeamMemberRequestSchema>;

export const teamDetailSchema = teamSummarySchema.extend({
  members: z.array(
    z.object({ id: z.string(), name: z.string(), email: z.string(), role: teamRoleSchema }),
  ),
  models: z.array(z.object({ id: z.string(), publicModelName: z.string() })),
});
```

In `apps/api/src/modules/teams/team.controller.ts`, lower the guard on the three delegated routes
from `ADMIN` to `MEMBER` and pass the role through. `POST /teams` and `DELETE /teams/:id` keep
`ADMIN`:

```ts
    app.post('/teams/:id/members', { preHandler: guards('MEMBER') }, async (request, reply) => {
      const { id } = parse(idParamSchema, request.params);
      const { userId, role } = parse(addTeamMemberRequestSchema, request.body);
      await services.teams.addMember(authOf(request), id, userId, role);
      return reply.code(201).send({ ok: true as const });
    });

    app.delete('/teams/:id/members/:userId', { preHandler: guards('MEMBER') }, async (request, reply) => {
      const { id, userId } = parse(memberParamsSchema, request.params);
      await services.teams.removeMember(authOf(request), id, userId);
      return reply.code(204).send();
    });

    app.put('/teams/:id/models', { preHandler: guards('MEMBER') }, async (request) => {
      const { id } = parse(idParamSchema, request.params);
      const { modelIds } = parse(setModelAccessRequestSchema, request.body);
      return { models: await services.teams.setModelAccess(authOf(request), id, modelIds) };
    });
```

Because the POST upserts, re-posting an existing member with a new role is how a role changes —
no second route.

- [ ] **Step 7: Show the role in the dashboard**

In `apps/web/src/features/teams/TeamsPage.tsx`, render each member's role beside their name using
an existing `shared/ui` badge primitive and a Geist token — no new one-off styles. Render the
"make lead" / "remove lead" control only when `session.role` is `OWNER` or `ADMIN`, matching the
server rule, and wire it to the existing add-member mutation in
`apps/web/src/features/teams/queries.ts` with `role: 'LEAD'`. Check both themes before moving on.

- [ ] **Step 8: Verify the whole suite**

```bash
npm run typecheck && npm test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Let a team lead manage their own team

A lead runs their team's membership and model access without gaining any
authority over providers, other teams, keys, or budgets. Only an admin may
appoint or remove a lead, so a lead cannot mint peers."
```

---

### Task 5: Update the project documentation

The architecture rules in `CLAUDE.md` are load-bearing — they are read by every future
contributor and by every agent working in this repo. A rule that names a deleted concept is worse
than no rule.

**Files:**
- Modify: `CLAUDE.md`, `PLAN.md`, `README.md`, `docs/security.md`

**Interfaces:**
- Consumes: the finished state of Tasks 1, 3, and 4.
- Produces: nothing downstream.

- [ ] **Step 1: Replace the tenancy hard rule**

In `CLAUDE.md`, the line

```
- `organizationId` always comes from the session, never from a request body or query.
```

becomes

```
- `userId` and `role` always come from the session, never from a request body or query.
  Team-scoped authority (`TeamRole.LEAD`) is checked in `TeamService`, not in a route guard:
  it is a database read, and controllers do not branch on domain state.
```

- [ ] **Step 2: Rewrite the opening description**

`CLAUDE.md` currently opens: "We own organizations, users, providers, the model catalog, key
lifecycle, budgets, and the dashboard." Replace `organizations` with `teams`, and add a sentence
stating that Gatehouse is single-tenant: one deployment serves one organization, which is
implicit and has no representation in the schema.

- [ ] **Step 3: Update PLAN.md and README.md**

Remove the multi-tenancy framing from both — organization switching, per-organization
namespacing, and any table listing an `organizationId` column. Describe teams and the `LEAD` role
in their place. `README.md` also needs its model-naming example changed from `{orgSlug}/gpt-5` to
`{providerSlug}/gpt-5`.

- [ ] **Step 4: Check for stragglers**

```bash
grep -rin 'organization' README.md PLAN.md CLAUDE.md docs/security.md
```

Expected: only sentences that deliberately describe the *absence* of the concept, or the phrase
"one organization" describing the deployment model.

- [ ] **Step 5: Verify a fresh clone still works end to end**

```bash
docker compose down -v
./scripts/setup-env.sh
docker compose up -d --wait
INTEGRATION=1 npm run -w apps/api test
docker compose -f docker-compose.prod.yml build
```

Expected: all PASS. This is the constraint that the project must be forkable and deployable
unmodified, and it is the last chance to catch a change that only works with hand-editing.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md PLAN.md README.md docs/security.md
git commit -m "Document the single-tenant model and the team-lead role"
```
