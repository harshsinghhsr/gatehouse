# Single-tenant Gatehouse, team leads, and floci

Status: approved design, not yet implemented
Date: 2026-08-22

Two independent changes land together because both rewrite the same files.

1. **floci replaces LocalStack** as the local AWS stand-in.
2. **Organizations are removed.** Gatehouse becomes single-tenant: one deployment, one
   organization, implicit. Teams remain and gain a `LEAD` role.

## 1. floci replaces LocalStack

LocalStack's community edition was archived in March 2026 — it now demands an auth token and
receives no security updates. [floci](https://github.com/floci-io/floci) is MIT-licensed, free,
and deliberately drop-in: same port 4566, same `/_localstack/health` path, unchanged AWS SDK and
CLI calls.

No application code changes. `AwsSecretStore` only ever knew an endpoint URL.

| File | Change |
|---|---|
| `docker-compose.yml` | Service `localstack` → `floci`; image `localstack/localstack:4` → `floci/floci:1.5.11`; drop `SERVICES`/`DEBUG`; add `FLOCI_STORAGE_MODE: memory` |
| `.github/workflows/ci.yml` | `--profile aws up -d --wait floci` |
| `.env.example`, `README.md`, `PLAN.md`, `CLAUDE.md`, `docs/security.md` | `http://localstack:4566` → `http://floci:4566` |
| `apps/api/test/support/stack-env.ts` | `CONTAINER_HOSTS` entry |

The image stays pinned, matching how LiteLLM is pinned. The healthcheck relaxes to
`curl -sf http://localhost:4566/_localstack/health` rather than grepping for LocalStack's exact
`"secretsmanager": "available"` JSON, which floci does not promise to reproduce byte for byte.

## 2. Organizations removed

### Rationale

This is a self-hosted control plane that a single organization runs on its own infrastructure.
The `Organization` table modelled a tenancy boundary that no deployment crosses, and it taxed
every layer: a column on every table, a parameter on every repository and service method, a
switcher in the UI, and a mirrored organization inside LiteLLM.

Teams are the grouping that survives, because teams are real.

### Data migration

Clean break. `apps/api/prisma/migrations/` currently holds one migration, `20260819205310_init`,
so it is squashed and regenerated as a single fresh init. Anyone running a pre-existing
deployment drops their database and re-bootstraps.

### Schema

- `Organization` and `Membership` are deleted.
- `User` gains `role Role` and `litellmUserId String? @unique` — the two fields `Membership`
  actually carried.
- `organizationId` is dropped from `Provider`, `Team`, `ModelAccess`, `GatewayKeyReference`,
  `Budget`, and `AuditLog`. Indexes narrow accordingly: `@@index([status])` on keys,
  `@@index([createdAt])` on audit logs, `@@unique([userId, teamId])` on budgets, and `@@index([organizationId])` disappears from `ModelAccess` entirely.
- `Team.slug` and `Provider.name` become globally `@unique`.
- `Provider` gains `slug String @unique`, derived from the name via `slugify` at creation and
  immutable thereafter. This is the new model namespace.
- New `enum TeamRole { MEMBER, LEAD }`; `TeamMember` gains `role TeamRole @default(MEMBER)`.

`enum Role { OWNER, ADMIN, MEMBER }` survives unchanged, now on `User`, and remains
instance-wide.

### Model namespacing

`ProviderModel.litellmModelName` becomes `{provider.slug}/{publicModelName}` — for example
`openai-prod/gpt-5`. It stays globally unique and mirrors the existing
`@@unique([providerId, publicModelName])` constraint, so two providers may both expose `gpt-5`
(an Azure and a direct-OpenAI one, during a migration or for failover).

Developers still type `gpt-5`. The key's `aliases` map already translates public name to gateway
name, and the reasoning in `toKeyPayload` — that LiteLLM checks `models` before resolving
`aliases`, so both names must be allowed — remains true. Only the justifying comment changes:
the namespace is per-provider, not per-organization.

`Provider.litellmCredentialName` becomes `{provider.slug}__{providerId}`. The id is retained so
that deleting and recreating a provider under the same name cannot collide with the old
credential.

### Secrets

`secretReference(deployEnv, organizationId, providerId)` becomes
`secretReference(deployEnv, providerId)`, producing `gatehouse/{deployEnv}/providers/{providerId}`.

### Auth and session

- `Session` becomes `{ userId }`.
- `AuthContext` becomes `{ userId, role, ip }`.
- `Authenticator` re-reads the `User` on every request instead of the membership. Live role
  revocation and disabled-account enforcement behave exactly as before.
- `RegisterRequest` loses `organizationName`. The first account is still the OWNER, and sign-up
  still closes afterwards unless `ALLOW_SIGNUP=true`.

### Module layout

- `apps/api/src/modules/organizations/` is deleted.
- `user.repository.ts` moves to a new `modules/users/`.
- A new `modules/users/user.service.ts` holds `ensureGatewayUser`, the surviving half of
  `OrganizationService`. `ensureGatewayOrganization` is deleted outright.
- `slug.ts` moves to `core/slug.ts`; both providers and teams use it.
- `AccessService.requireMembership` becomes `requireUser`, reading `repos.users`.
- The `/audit-logs` route, which lived incongruously in `organization.controller.ts`, moves to a
  new `audit.controller.ts` beside the audit service that already exists.
- `GET /organizations` and `POST /organizations/:id/switch` are removed.
- `Repositories` drops `organizations` and `memberships`.

Every service and repository method drops its leading `organizationId` parameter. Mechanical, but
the bulk of the diff across roughly 45 files.

### Gateway port

- `createOrganization` is deleted.
- The `organizationId` argument drops from `createUser` and `createTeam`.
- `organizationUsage(organizationId, from, to)` becomes `instanceUsage(from, to)`.

`instanceUsage` calls `GET /user/daily/activity` with `start_date`, `end_date`, and `page_size`
but **no** `user_id`, authenticated with the master key. The response schema is
`SpendAnalyticsPaginatedResponse`, identical to what `/organization/daily/activity` returns, so
`toUsageReport` is untouched.

`GET /gateway/daily/activity` was considered and rejected: it returns
`GatewayRequestActivityResponse`, which breaks down request counts by route and carries no spend,
model, or provider dimension.

**This is the one assumption in this design that must be verified against a live LiteLLM before
the rest of the usage work is built** — that an unfiltered `/user/daily/activity` under the master
key returns instance-wide data rather than an empty set. The acceptance test asserts it. If it
does not hold, the fallback is to keep a single LiteLLM-side organization purely as a spend
rollup bucket, invisible to our schema and our API.

### Team leads

`TeamMember.role` distinguishes a `LEAD` from a `MEMBER`. A lead manages their own team's
membership and model access without gaining any authority over providers, other teams, keys, or
budgets.

**The check lives in `TeamService`, not in a route guard.** "Is this caller a lead of *this*
team" is a database read, and CLAUDE.md forbids controllers from branching on domain state.
`TeamService` already receives `AuthContext` on every mutation, so a private
`assertCanManage(context, teamId)` drops in with no controller change beyond lowering the guard.

`AuthContext` is deliberately not extended with team leadership: it is per-team, so it is one
repository lookup on mutating paths only, never on every request.

| Route | Guard | Service check |
|---|---|---|
| `GET /teams`, `GET /teams/:id` | `MEMBER` | none |
| `POST /teams` | `ADMIN` | none — creating teams is instance-level |
| `DELETE /teams/:id` | `ADMIN` | none — deletion is not delegated |
| `POST /teams/:id/members` | `MEMBER` | `assertCanManage` |
| `DELETE /teams/:id/members/:userId` | `MEMBER` | `assertCanManage` |
| `PUT /teams/:id/models` | `MEMBER` | `assertCanManage` |

`assertCanManage` passes for `OWNER` and `ADMIN`, or for a caller whose `TeamMember` row on that
team has `role = LEAD`. Otherwise it throws `ForbiddenError`.

Two escalation guards:

- **Only `OWNER`/`ADMIN` may assign or revoke `LEAD`.** A lead may add and remove plain members
  only. Without this a lead could mint peers, or remove the admin who appointed them.
- `addTeamMemberRequestSchema` gains `role: teamRoleSchema.default('MEMBER')`, and `POST
  /teams/:id/members` becomes an upsert, so changing a member's role needs no second route.

**Grant scope**: a lead may grant their team any enabled model in the catalog. There is no
per-team allow-list. Spend is contained by budgets and observed through the audit log, not by
restricting which models a lead may choose. This is a deliberate choice appropriate to a single
trusted organization; a pre-approval layer is a feature to add later, not a guard omitted now.

### Wire contract

- `organizationSummarySchema` is deleted.
- `MeResponse` becomes `{ user, role }`.
- `registerRequestSchema` loses `organizationName`.
- `teamRoleSchema` joins `roleSchema` in `contracts/common.ts`.
- `teamDetailSchema.members` entries gain `role`.

### Web

- `DashboardLayout`: the organization crumb and slug badge are removed.
- `SettingsPage`: the Organization section is removed.
- `LoginPage`: the Organization field and its "creates your organization" copy are removed.
- `ModelsPage`: namespacing copy now describes provider slugs.
- `TeamsPage`: each member shows their role; the lead toggle renders only for admins.

### Testing

- `test/support/fakes.ts`: drop the organization and membership fakes; add
  `repos.teams.findMember`.
- `test/unit/security.test.ts` is rewritten. Its cross-tenant isolation assertions no longer
  describe anything real and are replaced by the boundary that does exist: a `LEAD` of team A
  receives 403 on team B's members, 403 on `/providers`, and 403 attempting to promote anyone to
  `LEAD`.
- `test/unit/key.service.test.ts`, `test/http/server.test.ts`,
  `test/integration/acceptance.test.ts`: updated signatures; the acceptance flow additionally
  asserts that `instanceUsage` returns non-empty data after a real request.

### Documentation

The CLAUDE.md hard rule "`organizationId` always comes from the session, never from a request
body or query" becomes: "`userId` and `role` always come from the session, never from a request
body or query." PLAN.md and README.md lose their multi-tenancy framing.

## Explicitly out of scope

- Per-team model allow-lists.
- Team-scoped budgets set by leads. Budgets stay `ADMIN`-only.
- Team deletion by leads.
- Any data-preserving upgrade path from the org-shaped schema.
