# Security policy

Gatehouse holds provider API keys and issues credentials that spend money. Please report
anything that looks like a weakness, even if you are not sure.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** button under the repository's Security tab. That opens a
private advisory visible only to the maintainers. Please do not open a public issue for anything
exploitable.

Include what you did, what happened, and what you expected. A proof of concept helps but is not
required.

## Supported versions

`main` is the supported version. There are no maintenance branches yet.

## Scope

In scope: this control plane — the API, the dashboard, the container images, and the compose files.

Out of scope: [LiteLLM](https://github.com/BerriAI/litellm) itself, which is used as an unmodified
upstream image; report those to that project. Also out of scope: findings that require an attacker
who already has the LiteLLM master key or database access, since both are total compromise by
definition.

## What this project already assumes

Before reporting, [docs/security.md](docs/security.md) lists the controls that are enforced and the
limitations that are accepted deliberately — the default file secret store being plaintext on the
host, LiteLLM's admin API being reachable on port 4000 in the compose stacks, and a few others.
Those are documented decisions rather than oversights, though an argument that one of them is worse
than documented is a legitimate report.

## Deploying this safely

The API refuses to boot with `NODE_ENV=production` if the LiteLLM master key is still a placeholder
or if `WEB_ORIGIN` is not https. Run `./scripts/setup-env.sh` to generate real secrets, and put TLS
in front of the stack.
