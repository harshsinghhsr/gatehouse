<h1 align="center">Gatehouse</h1>

<p align="center">
  <strong>Self-hosted control plane for the LiteLLM proxy.</strong><br>
  Give your developers virtual API keys with model access, budgets, and usage visibility —
  without ever handing out an OpenAI, Azure, or Anthropic credential.
</p>

<p align="center">
  <a href="https://github.com/harshsinghhsr/gatehouse/actions/workflows/ci.yml"><img src="https://github.com/harshsinghhsr/gatehouse/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License: Apache 2.0"></a>
  <img src="https://img.shields.io/badge/LiteLLM-v1.97.0-4f46e5" alt="LiteLLM v1.97.0">
  <img src="https://img.shields.io/badge/node-%E2%89%A522-339933" alt="Node 22+">
  <img src="https://img.shields.io/badge/self--hosted-yes-0f766e" alt="Self-hosted">
</p>

---

## The problem

Your company buys LLM capacity once — an Azure OpenAI deployment, an OpenAI org, an Anthropic
account — and then has to share it with everybody who writes code.

In practice that means the provider key ends up in a group chat, a shared vault entry, or six
`.env` files. Once it spreads, you lose the things you actually needed:

- **You cannot tell who spent what.** One bill, one key, no attribution.
- **You cannot cap anyone.** A retry loop in a prototype bills the whole company.
- **You cannot revoke one person.** Rotating the key breaks every service at once.
- **You cannot control who reaches which model.** Everyone with the key has everything.
- **Offboarding is a rotation event**, so it quietly doesn't happen.

[LiteLLM](https://github.com/BerriAI/litellm) already solves the hard half of this. It proxies
every provider behind one OpenAI-compatible endpoint, authenticates virtual keys, enforces budgets
and rate limits, and prices every request. What it doesn't ship is the operational layer a company
needs on top: organizations and roles, an admin who can onboard a provider without touching a
config file, a developer who can see their own usage, an audit trail of who granted what, and
somewhere safe for the provider credential to live.

**Gatehouse is that layer.** LiteLLM stays the gate — unmodified, unforked, pinned to a released
image. Gatehouse is the gatehouse: it decides who gets a key, what that key can reach, and what
happens when someone leaves.

## What your developers see

Two lines change. Every OpenAI-compatible SDK, framework, and tool keeps working.

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-gatehouse-issued-key",       # not your provider key
    base_url="https://llm.your-company.com/v1",
)
client.chat.completions.create(model="gpt-5", messages=[{"role": "user", "content": "Hello"}])
```

The same key works from the Anthropic SDK, LangChain, LlamaIndex, Cursor, or plain `curl` — it is
the LiteLLM endpoint underneath, so anything that speaks OpenAI or Anthropic speaks to it.

## What you get

| | |
|---|---|
| **Providers without credential sharing** | Add Azure OpenAI, OpenAI, or Anthropic once. The secret goes to AWS Secrets Manager or a 0600 file on the host — Postgres only ever stores a *reference*. It is never returned by an API, never logged, never in the browser bundle. |
| **Virtual keys, issued and revoked** | Mint a key for a developer, show it once, never store it. Revoke it and the next request fails at the gateway in seconds. Rotation does not touch anyone else. |
| **Per-model access grants** | A developer reaches exactly the models they were granted. Models are namespaced per organization, so two tenants can both publish `gpt-5`. |
| **Budgets that actually stop spend** | Monthly or daily caps per developer or per team, enforced by LiteLLM at request time — not a dashboard that emails you afterwards. |
| **Usage and cost attribution** | Spend per developer, per team, per model, over any date range, priced by LiteLLM's own cost map. |
| **Organizations, teams, and RBAC** | Owner, admin, and member roles. `organizationId` always comes from the session, never from the request, so cross-tenant access returns 404 rather than leaking existence. |
| **An audit log you can defend** | Every mutation and its audit row commit in the same transaction, with secret-shaped values scrubbed before they are written. |
| **A connect page** | Copy-paste snippets with the developer's own base URL and model names, so onboarding is a link rather than a conversation. |

## Quickstart

Requires Docker and Docker Compose. No cloud account, no API key needed to try it.

```bash
git clone https://github.com/harshsinghhsr/gatehouse.git
cd gatehouse
./scripts/setup-env.sh     # writes .env with generated secrets
docker compose up
```

| Service | URL |
| --- | --- |
| Dashboard | <http://localhost:3000> |
| Control plane API | <http://localhost:3001> |
| LiteLLM gateway | <http://localhost:4000> |

Open the dashboard, choose **Set up the platform**, and create the first account — that bootstraps
your organization and its owner. Sign-up closes itself afterwards; admins add everyone else from
**Developers**.

Then: add a provider → add a model → add a developer → grant models → create a key → open
**Connect** for the snippets. `curl localhost:3001/ready` reports the health of every dependency.

## How it works

```text
browser ──▶ Gatehouse API ──▶ Postgres            orgs, users, providers, catalog,
             (Fastify)         │                  key references, budgets, audit
                               ├──▶ Secrets Manager / file    provider credentials, by reference
                               └──▶ LiteLLM admin API         keys, models, credentials, spend

developer SDK ─────────────▶ LiteLLM ──▶ Azure OpenAI / OpenAI / Anthropic
```

Two properties fall out of this split, and both are deliberate:

- **The browser never holds a secret.** Not the master key, not a provider credential, not a
  gateway key beyond the single moment it is displayed.
- **Gatehouse is never in the path of an LLM request.** If the control plane is down, inference
  keeps serving. It is a control plane, not a proxy in front of a proxy.

## How this compares

| | Gatehouse | LiteLLM alone | Hosted gateways |
| --- | --- | --- | --- |
| Provider credentials | Never leave your infrastructure | Never leave your infrastructure | Uploaded to a vendor |
| Issuing keys to people | Dashboard, with roles and an audit trail | Admin API or the built-in UI, single-tenant | Dashboard |
| Multi-tenant orgs and RBAC | Yes | Partial | Usually paid |
| Data residency | Your Postgres, your VPC | Yours | Vendor's |
| Cost | Free, Apache-2.0 | Free, MIT | Per-request or per-seat |
| Runs without the internet | Yes, aside from the providers themselves | Yes | No |

Gatehouse is **not** a LiteLLM replacement or fork, and does not reimplement anything LiteLLM
already does — keys, budgets, rate limits, cost math, and routing all stay upstream. That is a
maintenance decision as much as a technical one: when LiteLLM adds a provider, you get it.

## Deploying

```bash
./scripts/setup-env.sh                              # if you have not already
# set WEB_ORIGIN and GATEWAY_PUBLIC_URL to your https URLs in .env
docker compose -f docker-compose.prod.yml up -d --build
```

That is the whole deployment. It differs from the development stack in the ways that matter:
Postgres and Redis are not published to the host, no source is mounted, the API runs as an
unprivileged user with `NODE_ENV=production`, the dashboard is static files behind nginx on
`:8080`, migrations are applied at boot, and everything restarts on its own.

Two ports need to be reachable: the dashboard (`WEB_PORT`, default 8080) and the gateway that
developer SDKs call (`GATEWAY_PORT`, default 4000). **Put TLS in front of both** — a reverse proxy,
a load balancer, or Cloudflare. The session cookie is `Secure` in production, so the API refuses to
boot if `WEB_ORIGIN` is not https, and it refuses to boot if the LiteLLM master key is still the
placeholder from `.env.example`.

The dashboard and the API are one origin: nginx proxies `/api` to the API container, so there is no
CORS to configure and nothing about your domain is baked into the frontend bundle. The same image
runs anywhere.

Provider credentials go to a 0600 file on a Docker volume by default, which needs no cloud account.
Set `SECRETS_BACKEND=aws` to put them in AWS Secrets Manager instead.

## Security

Threat model, what a dedicated review found and fixed, and what is deliberately still open:
[docs/security.md](docs/security.md). The short version:

- Provider credentials never touch Postgres, a log line, an audit entry, or an API response.
- Gateway keys are displayed once and never stored — only an alias, a token id, and a masked prefix.
- `organizationId` comes from the session, always; a foreign record returns 404, not 403.
- Provider base URLs are checked against a host allowlist with private, loopback, and cloud
  metadata ranges refused, and redirects are never followed.
- Passwords are scrypt with a per-password salt; sessions are server-side in Redis with the id
  rotated on login; CSRF is SameSite=Lax plus an Origin check on every mutation.

Found something? [SECURITY.md](SECURITY.md) has the private reporting process.

## Development

```bash
npm install
npm run typecheck
npm test                                  # unit + HTTP tests, no services needed

docker compose up -d
INTEGRATION=1 npm run -w apps/api test    # acceptance flow + AWS contract, against the real stack

# migrations run inside the api container, which already has DATABASE_URL
docker compose exec api npm run -w apps/api prisma -- migrate dev --name <name>
```

The acceptance test is the real thing: it grants a model, mints a key, calls the gateway with an
OpenAI-shaped request, revokes the key, and asserts the next call fails with 401. It uses LiteLLM's
`mock_response`, so it never calls a real provider. CI runs it against a stack built from a clean
clone, then builds the production images — so a green build means a fork can deploy.

### How the code is organised

The backend is layered, and the layers are enforced by what each one is allowed to import:

```text
http/          Fastify: server, guards, error handler        knows about HTTP
modules/*/     controller -> service -> repository           the business logic
core/          config, domain errors, ports, unit of work    knows about nothing
infra/         prisma, redis, litellm, secrets, logger       knows about vendors
container.ts   composition root: builds everything once
```

Services depend on interfaces (`UnitOfWork`, `LlmGateway`, `SecretStore`, …), never on Prisma or
`fetch`, so a unit test hands them an in-memory fake instead of a database. `packages/shared` holds
the zod contracts both apps import, so a payload change breaks the build rather than production.
The frontend is React on Vite, with TanStack Query owning all server state.

The API runs TypeScript directly through `tsx`, in development and production alike — one code
path, no build artifact to get stale. [CONTRIBUTING.md](CONTRIBUTING.md) has the rules that keep
this workable.

### Testing the AWS path without AWS

Provider credentials can live in AWS Secrets Manager. To exercise that code path locally, run
[LocalStack](https://github.com/localstack/localstack) — the community edition covers Secrets
Manager, the only AWS service this needs:

```bash
docker compose --profile aws up -d localstack
INTEGRATION=1 npm run -w apps/api test
```

The same `AwsSecretStore` class runs in both cases; only the endpoint differs. What you test
locally is the production code path, not a mock of it.

## FAQ

**Does this fork or patch LiteLLM?** No. It runs the released image
`ghcr.io/berriai/litellm:v1.97.0` and talks to its HTTP API. Gatehouse never touches LiteLLM's
database. The contract is the OpenAPI spec that image itself serves, snapshotted at
[litellm/openapi.v1.97.0.json](litellm/openapi.v1.97.0.json); upgrade notes are in
[docs/litellm-notes.md](docs/litellm-notes.md).

**Which providers work?** Azure OpenAI, OpenAI, and Anthropic have first-class onboarding. Anything
else LiteLLM supports can be reached, but has not had a provider adapter written for it yet.

**Do developers need a new SDK?** No — `api_key` and `base_url`, nothing else. OpenAI-compatible and
Anthropic-compatible endpoints are both exposed.

**Do I need AWS?** No. The default secret backend is a file on a Docker volume. AWS Secrets Manager
is opt-in with one environment variable.

**Can I run it without Docker?** Yes — Node 22, Postgres 17, Redis/Valkey, and a LiteLLM instance.
Compose is just the packaged version of that.

**Is it multi-tenant?** Yes. Organizations are isolated at every query, and models are namespaced
per organization inside the gateway.

**What is the license?** Apache-2.0, including for commercial and internal use.

## Roadmap

- OIDC / SSO login — the auth layer is isolated so it can be added without touching route code
- Terraform module for the AWS deployment (phase 8 of [PLAN.md](PLAN.md))
- Provider adapters beyond Azure, OpenAI, and Anthropic
- Backup and restore runbook

Issues and pull requests are welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). LiteLLM is a separate project under its
own license, used here as an unmodified upstream image.
