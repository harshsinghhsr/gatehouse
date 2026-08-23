# Gatehouse examples

Runnable proof that a Gatehouse key does what it claims: it reaches the models a developer was
granted, it is billed to them, and it stops working the moment an admin says so.

Every script here talks to Gatehouse over the same public HTTP API the dashboard uses, and to the
gateway over the ordinary OpenAI and Anthropic wire protocols. There is no private back door and
no Gatehouse client library — that is the point.

## Before you start

```sh
cd ..
docker compose up            # postgres, redis, litellm, api, web
npm run seed                 # providers, models, people, teams, budgets, some traffic
cd examples
npm install                  # only for example 3, the SDK one
```

The seed creates its models behind a **mock provider**, a development-only provider type enabled
by `ENABLE_MOCK_PROVIDER` in the dev compose file. Its models answer from inside LiteLLM, so you
need no vendor API key to run any of this — but the tokens are counted and priced exactly as real
ones are, so the spend you read back in example 5 is real bookkeeping over fake answers.

The seeded accounts all share the password `GatehouseDev!2026`. It is a **development default**,
hard-coded in `scripts/seed-dev.ts`, and every script here refuses to run against anything but
`localhost` — the same guard the seed uses. Nothing in this folder will ever work against a
deployment, by design: these scripts revoke keys and disable people.

## The examples

Run them in order.

| | | |
|---|---|---|
| 1 | `node 1-issue-key.mjs` | Sign in as an admin and mint a gateway key for a developer. |
| 2 | `./2-call-gateway.sh` | Call the gateway with it, using nothing but `curl`. |
| 3 | `node 3-sdks.mjs` | The same call through the official OpenAI and Anthropic SDKs. |
| 4 | `node 4-enforcement.mjs` | Six ways a call gets refused, with the real status codes. |
| 5 | `node 5-usage.mjs` | Read the resulting spend back out of Gatehouse. |
| 6 | `node 6-cleanup.mjs` | Revoke the key from example 1 and delete the local copy. |

Examples 1–3 and 6 use the seeded developer `direct@gatehouse.dev`, so their traffic shows up on
the dashboard next to everything else. Example 4 creates a developer of its own,
`examples@gatehouse.dev`, because it revokes keys and disables people; it restores them on the way
out and is safe to run as many times as you like. If anything ever looks wrong, `npm run seed`
from the repo root puts the instance back.

`POST /api/auth/login` is rate limited to five attempts per quarter hour, so the scripts cache the
admin session cookie in `.gatehouse-session` (also `0600` and gitignored) rather than signing in
six times. Example 6 deletes it. If you hit the limit anyway, wait it out — that guard is doing its
job.

### 1. Issue a key

`POST /api/developers/:id/keys`. What comes back is a LiteLLM virtual key, already scoped to that
developer's granted models with their budget and rate limits attached. The developer never sees a
provider credential — the real OpenAI or Anthropic key stays in the secret store.

**The plaintext is returned exactly once and Gatehouse never stores it.** The database keeps an
alias, a LiteLLM token id, and a masked prefix, and that is all you will ever see again. So this
example writes the key to `.gatehouse-key` (mode `0600`, gitignored) for the later scripts, and
prints only the mask. Nothing here ever logs a key, a password, or the LiteLLM master key.

### 2 and 3. Call the gateway

Look at the constructors in `3-sdks.mjs` and compare them to the vendor's own quickstart. The
difference is the base URL and the key. Existing code moves onto the gateway by changing two
lines, and in exchange the operator gets model allow-lists, budgets, and per-developer spend.

The base URLs are not hard-coded: both examples read them from `GET /api/connect`, so an operator
who moves the proxy changes one setting and every client keeps working.

### 4. Enforcement — the interesting half

A key you cannot take away is not a credential, it is a liability. Each case below makes a real
change in Gatehouse and then proves it with a real request.

| Case | Why it matters |
|---|---|
| A model that was never granted | The allow-list lives on the key and is enforced at the proxy, so a developer cannot reach the expensive model nobody approved — not by editing their client, not by guessing a name. |
| A revoked key | Offboarding. Pressing revoke has to kill the credential everywhere, at once, with no redeploy. |
| A rotated key | Rotation mints the replacement *before* killing the old key, so a leaked credential is replaced without a window where nothing works. The example shows the old one failing and the new one working. |
| A disabled developer's key | Disabling a person must not mean hunting down their keys one at a time. Gatehouse revokes every active key as part of the status change. |
| An exhausted budget | A ceiling that is only a dashboard warning is not a control. LiteLLM refuses the call that would exceed it, in the request path. |
| Issuing a key to a disabled developer | The control plane refuses too, so there is no way to hand out a credential that should not exist. |

The script prints the exact status code and error body for each, and a summary table at the end.
It does not assert an expected outcome — it reports what the gateway actually said.

Two details worth knowing, both visible in the output:

- **The budget ceiling is attached to the key when the key is minted**, and LiteLLM tracks the
  spend per key. A developer holding two keys therefore has two ceilings, not one shared
  allowance. That is why the budget case issues a fresh key.
- **Re-enabling a developer does not resurrect their keys.** They stay revoked; the developer gets
  a new one. That is the right default, and it is worth knowing before you disable someone.

### 5. The feedback loop

`GET /api/usage`, `/api/usage/developers`, `/api/usage/models`. The calls you just made come back
attributed to the person whose key made them — which is the entire reason for issuing keys through
a control plane rather than sharing a provider key.

Every figure originates in LiteLLM. Gatehouse asks the proxy and reformats; it keeps no price
table of its own and never recomputes a token cost.

One caveat that belongs to the mock provider, not to the product: LiteLLM v1.97 prices some
mocked models at `$0` even though their requests and token counts are real. Prefer an
OpenAI-priced model (`gpt-4o`, `o1-pro`) when you want a dollar figure to look at.

## Environment

Everything has a working default. Override only if your stack is not on the usual ports.

| Variable | Default |
|---|---|
| `GATEHOUSE_API_URL` | `http://localhost:3001/api` |
| `GATEHOUSE_ADMIN_EMAIL` | `owner@gatehouse.dev` |
| `GATEHOUSE_ADMIN_PASSWORD` | `GatehouseDev!2026` (dev seed default) |
| `GATEHOUSE_DEVELOPER` | `direct@gatehouse.dev` (example 1) |
| `GATEHOUSE_GATEWAY_URL` | `http://localhost:4000/v1` (example 2) |
| `GATEHOUSE_FROM` / `GATEHOUSE_TO` | today (example 5) |

This folder is deliberately outside the repo's npm workspaces. Its `package.json` exists only so
example 3 can install the two vendor SDKs; nothing here is a dependency of the product.
