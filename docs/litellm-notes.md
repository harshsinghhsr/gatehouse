# LiteLLM integration notes

Pinned image: `ghcr.io/berriai/litellm:v1.97.0`.

The contract is `litellm/openapi.v1.97.0.json` — dumped from the running pinned container
(`curl localhost:4000/openapi.json`), not from the docs site. The public docs swagger serves
an older build (1.82.6 at time of writing) and must not be used as the source of truth.

## Verified on the pinned image (2026-08-19)

- Spec `info.version` = `1.97.0`, 521 paths.
- Present and confirmed: `/key/generate`, `/key/delete`, `/key/{key}/regenerate`,
  `/credentials`, `/model/new`, `/user/daily/activity`, `/v1/messages`, `/health/readiness`.
- `general_settings.store_model_in_db: true` + `STORE_MODEL_IN_DB=True` accepted; the proxy
  boots and runs its own migrations against its own database.
- Master key auth works: `GET /model/info` with `Authorization: Bearer $LITELLM_MASTER_KEY` → 200.
- `/health/liveliness` is the cheap probe. `/health` fans out to every configured provider —
  never use it for a container healthcheck or our `/ready`.

## Verified by running against it (phases 3-6)

- **`POST /key/delete` with `{key_aliases: [...]}` works.** Revoke and rotate never need the
  plaintext key, so we never store one. `/key/{key}/regenerate` still wants the secret in the
  path, so we do not use it — rotation is generate-new-then-delete-old-alias.
- **Model access is checked before alias resolution.** A key whose `models` list holds only
  `acme/gpt-5` rejects a request for `gpt-5` with `key_model_access_denied`, even when the key's
  `aliases` map contains `gpt-5 -> acme/gpt-5`. Keys therefore carry both the namespaced and the
  public name, and the alias does the routing. This was found by the integration test, not the docs.
- **`mock_response` in `litellm_params` gives a model that answers with no provider credential** —
  that is what makes the acceptance test runnable without touching a real provider.
- `POST /model/new` at runtime with `STORE_MODEL_IN_DB=True` serves traffic on the next request,
  with no restart, exactly as documented.
- `/organization/new`, `/user/new`, `/team/new`, `/team/member_add` all accept the mirror writes.
- A revoked key returns 401 from `/v1/chat/completions` immediately.

## Still unverified

- Whether `/credentials` values survive a proxy restart with the same `LITELLM_SALT_KEY`
  (they are encrypted with it, so they should — untested).
- `/user/daily/activity` breakdown shapes are typed from the spec but not yet exercised with real
  spend; the dashboard reads them defensively.

## Upgrade process

1. Bump the tag in `docker-compose.yml` and the AWS task definition.
2. Boot it, dump `/openapi.json`, diff against the committed snapshot.
3. Regenerate client types from the new snapshot; fix whatever the compiler flags.
4. Run the integration tests in `apps/api/test`.
5. Commit the new snapshot alongside the version bump — never separately.

Never change `LITELLM_SALT_KEY` after any model or credential exists: LiteLLM encrypts stored
provider credentials with it, and a new value makes them undecryptable.
