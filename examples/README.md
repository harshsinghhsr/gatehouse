# Gatehouse examples

Two readers, two folders.

- **`developer/`** — someone handed you a key. Nothing here signs into Gatehouse or knows it
  exists: these call the LiteLLM proxy on port 4000 directly, because **Gatehouse is not in the
  request path**. Copy any of them into your own project and change the string.
- **`operator/`** — you run Gatehouse. These drive the same public HTTP API the dashboard uses,
  to create developers, grant models, set budgets, mint and rotate keys, and read spend back.

Every file is standalone. There is no shared harness to learn first, no numbering, and no state
passed between scripts — the duplicated sign-in boilerplate in `operator/` is deliberate, so that
one file is the whole story.

## Before you start

```sh
cd ..
docker compose up            # postgres, redis, litellm, api, web
npm run seed                 # providers, models, people, teams, budgets, some traffic
cd examples
npm install                  # openai + @anthropic-ai/sdk + tsx, only for this folder
```

This folder is **outside the repo's npm workspaces** on purpose: a contributor's `npm install` at
the root must not pull two vendor SDKs for an optional folder. Its TypeScript still imports the
wire contract from `packages/shared` by relative path, so the operator examples are compiled
against the same zod schemas the API and the dashboard are — `npm run typecheck` here fails if a
payload changes underneath them.

**No vendor API key is needed.** The seed publishes its models behind a **MOCK provider**
(`ENABLE_MOCK_PROVIDER`, development-only), whose answers are generated inside LiteLLM. But the
tokens are counted and priced from LiteLLM's real table, so the spend you read back is real
bookkeeping over mocked answers.

The seeded accounts share the password `GatehouseDev!2026`. It is a **development default**,
hard-coded in `scripts/seed-dev.ts`. Every script in `operator/` refuses to run against anything
but `localhost`, the same guard the seed uses.

## `developer/` — you have a key

```sh
export GATEHOUSE_KEY=sk-...        # printed by operator/onboard-developer.ts

npx tsx developer/openai-sdk.ts    # chat completion through the official OpenAI SDK
npx tsx developer/anthropic-sdk.ts # the same key over the Anthropic wire protocol
npx tsx developer/streaming.ts     # stream: true, and where the token counts went
./developer/curl.sh                # no SDK at all, and the per-call cost header
```

Compare the SDK constructors with the vendors' own quickstarts: the difference is the base URL
and the key. That is the whole migration. In exchange the operator gets a model allow-list, a
budget, and per-developer spend.

Two base URLs, because the vendors differ: OpenAI clients want `http://localhost:4000/v1`,
Anthropic clients want `http://localhost:4000` and append `/v1/messages` themselves. An operator
who has moved the proxy can read both from `GET /api/connect`.

**Does streaming work?** Yes. `stream: true` relays server-sent events through the proxy
unchanged. The mock provider does stream — the fixed sentence arrives as ~22 small deltas — but
all at once, with none of a real model's pacing, so it proves the transport and not the latency.
A streamed OpenAI response also carries no `usage` block unless you ask for one with
`stream_options: { include_usage: true }`; spend is metered either way.

## `operator/` — you run Gatehouse

```sh
npx tsx operator/onboard-developer.ts   # the end-to-end workflow, start here
npx tsx operator/rotate-key.ts          # replace a key with no window of downtime
npx tsx operator/read-spend.ts          # who spent what, per developer and per model
```

`onboard-developer.ts` is the one to read: sign in, create a developer, grant models, set a
budget, mint the key, print what to hand over. It is what the dashboard does across five screens,
and it is re-runnable — it reuses `newcomer@gatehouse.dev` if it already made them.

Three things worth knowing, all visible in those files:

- **The plaintext key is returned exactly once and never stored.** Gatehouse keeps an alias, a
  LiteLLM token id, and a masked prefix. Nothing here writes a key to a file.
- **The budget belongs to the developer, not to the key.** Every key a developer holds draws on
  one shared allowance, so issuing a second key does not double the ceiling, and rotating does not
  reset it.
- **Re-enabling a disabled developer does not resurrect their keys.** Disabling revokes every
  active key; the developer gets a fresh one.

## When a call is refused

These are the statuses a developer actually sees. Read them here rather than running a script —
`apps/api/test/integration/enforcement.test.ts` is the executable proof, and it runs in the
integration suite where a regression gets caught:

```sh
INTEGRATION=1 npm run -w apps/api test
```

| Case | Status | Error |
|---|---|---|
| A model the developer was never granted | `403` | `key_model_access_denied` |
| A key revoked through Gatehouse | `401` | `token_not_found_in_db` |
| The old half of a rotated pair | `401` | `token_not_found_in_db` |
| A disabled developer's key | `401` | `token_not_found_in_db` |
| A budget driven over its ceiling | `429` | `budget_exceeded` |
| Issuing a key to a disabled developer | `409` | Gatehouse `conflict` |

**A model name that does not exist returns `403 key_model_access_denied`, not `404`.** This is the
single most confusing thing for a new user, and it is correct: the call goes straight to LiteLLM,
Gatehouse never sees it, and all the proxy knows is that the name is not on your key's allow-list.
It cannot distinguish "a model you were not granted" from "a model nobody has ever published".
When a call fails this way, check the grants before you check the spelling.

## Environment

Everything has a working default; override only if your stack is not on the usual ports.

| Variable | Used by | Default |
|---|---|---|
| `GATEHOUSE_KEY` | `developer/` | — (required) |
| `GATEHOUSE_OPENAI_URL` | `developer/` | `http://localhost:4000/v1` |
| `GATEHOUSE_ANTHROPIC_URL` | `anthropic-sdk.ts` | `http://localhost:4000` |
| `GATEHOUSE_MODEL` | `developer/` | `gpt-4o` |
| `GATEHOUSE_ANTHROPIC_MODEL` | `anthropic-sdk.ts` | `claude-sonnet-4-5` |
| `GATEHOUSE_API_URL` | `operator/` | `http://localhost:3001/api` |
| `GATEHOUSE_ADMIN_EMAIL` | `operator/` | `owner@gatehouse.dev` |
| `GATEHOUSE_ADMIN_PASSWORD` | `operator/` | `GatehouseDev!2026` (dev seed default) |
| `GATEHOUSE_NEW_DEVELOPER` | `onboard-developer.ts` | `newcomer@gatehouse.dev` |
| `GATEHOUSE_GRANT` | `onboard-developer.ts` | `gpt-4o,claude-sonnet-4-5` |
| `GATEHOUSE_DEVELOPER` | `rotate-key.ts` | `newcomer@gatehouse.dev` |
| `GATEHOUSE_FROM` / `GATEHOUSE_TO` | `read-spend.ts` | today |
