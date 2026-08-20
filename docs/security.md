# Security model and review

The dedicated pass (PLAN.md phase 9) ran against the implemented system. This records what is
enforced, what was found and fixed, and what is deliberately still open.

## Enforced

| Control | Where |
|---|---|
| Passwords | scrypt (N=32768, r=8, p=1), per-password salt, constant-time compare — `src/modules/auth/password.ts` |
| Sessions | 32 random bytes, server-side in Redis, 7-day TTL, httpOnly + SameSite=Lax cookie, `Secure` in production; the id rotates on login and on organization switch |
| Tenant isolation | `requireRole` establishes `organizationId` from the session; every query filters on it. A foreign organization gets 404, not 403 — existence is not disclosed |
| RBAC | `requireRole('MEMBER'\|'ADMIN'\|'OWNER')` on every route except login, register, and logout. Only an OWNER can change roles |
| CSRF | SameSite=Lax plus an Origin check on every non-GET, answered with 403 `cross_origin` |
| SSRF | Provider base URLs: https only, no embedded credentials, host must match the provider's allowed suffixes, every resolved address must be public (metadata, loopback, RFC1918, CGNAT, link-local all rejected), and probes never follow redirects |
| Secret storage | Postgres stores a `secretRef` only. Values live in AWS Secrets Manager (prod) or a 0600 local file (dev). Responses are built from field whitelists |
| Gateway keys | Plaintext returned once, never persisted. We keep alias + `token_id` + a masked prefix. Revoke and rotate work by alias, so the secret is never needed again |
| Master key | Backend-only, loaded from the environment, never in a response, never in the browser bundle, never logged |
| Log redaction | pino redaction on `authorization`, `cookie`, `set-cookie`, `*.api_key`, `*.apiKey`, `*.password`, `*.passwordHash`, `*.secret`, `*.token`, `*.master_key`, `*.credentials` |
| Audit scrubbing | The writer redacts any metadata key matching `key\|secret\|password\|token\|credential`, whatever the call site passes |
| Rate limits | 300/min per IP globally; 5/min per **account** on login; 5/15min on register; 20/min on provider and key creation. LLM traffic rate limiting is LiteLLM's |
| Input validation | zod at every route boundary; Prisma parameterizes all queries (the only raw SQL is `SELECT 1`) |
| XSS | React escaping throughout; no `dangerouslySetInnerHTML` anywhere |

## Found and fixed during the pass

1. **User enumeration through login timing.** A missing account skipped the scrypt work and answered
   measurably faster. Now every failed login verifies against a dummy hash generated at boot.
2. **LiteLLM error bodies echoed to the client.** A rejected admin call returned the gateway's
   response body, which can quote back what we sent it — including a credential on a
   `/credentials` failure. The body now goes to the server log; the client gets a status only.
3. **Cross-origin mutations returned 500.** The Origin check threw a bare `Error`, which the handler
   rendered as an internal error. Now a clean 403 with code `cross_origin`.
4. **Model access was bypassable in the other direction.** Integration testing showed LiteLLM checks
   the requested model name against the key's `models` list *before* resolving aliases, so a key
   scoped to `acme/gpt-5` rejected a developer typing `gpt-5`. Keys now carry both names. Safe only
   because every model this control plane registers is org-namespaced — noted in `src/modules/developers/access.service.ts`.

## Verified by test

`apps/api/test/unit/security.test.ts` and `test/integration/acceptance.test.ts` lock in: audit scrubbing, the SSRF
allowlist (including suffix smuggling like `openai.azure.com.evil.example`), credentials staying out
of `litellm_params`, unauthenticated 401s on every org-scoped route, cross-origin 403, cross-org 404
on a developer, a revoked key failing at the gateway, and a non-granted model being refused.

## Open, by decision

- **LiteLLM's admin API is exposed on :4000 in both compose files.** Fine for local development —
  it requires the master key. In production only `/v1/*`, `/chat/*`, `/models`, and `/anthropic/*`
  may be routed from the internet; `/key/*`, `/model/*`, `/credentials/*`, `/spend/*`, and `/ui`
  must be reachable only from the api service's security group.
- **The default secret store is a plaintext 0600 file** on a Docker volume, so provider
  credentials are only as private as the host. It is the default because it makes a single-node
  deployment work with no cloud account. `SECRETS_BACKEND=aws` moves them into Secrets Manager;
  the same `AwsSecretStore` runs against LocalStack locally, so that path is tested, not theoretical.
- **Registration bootstrap has a theoretical race.** Two simultaneous first requests could both pass
  the "no users yet" check. The window is one request wide on an empty database.
- **`/ready` is unauthenticated** and names which dependency is down. Standard for a health probe.
- **No CAPTCHA or account lockout.** Rate limits are the only brute-force control.
- **No OIDC/SSO yet.** The auth layer is isolated so it can be added without touching route code.
