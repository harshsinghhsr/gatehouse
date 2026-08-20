#!/bin/sh
# Writes .env from .env.example with freshly generated secrets. Safe to read before running.
set -e
cd "$(dirname "$0")/.."

if [ -e .env ]; then
  echo ".env already exists — refusing to overwrite it. Delete it first if that is what you want." >&2
  exit 1
fi

command -v openssl >/dev/null || { echo "openssl is required to generate secrets." >&2; exit 1; }

password=$(openssl rand -hex 16)
sed \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$password|" \
  -e "s|postgres:postgres@|postgres:$password@|g" \
  -e "s|^LITELLM_MASTER_KEY=.*|LITELLM_MASTER_KEY=sk-$(openssl rand -hex 24)|" \
  -e "s|^LITELLM_SALT_KEY=.*|LITELLM_SALT_KEY=$(openssl rand -hex 32)|" \
  .env.example > .env
chmod 600 .env

echo "Wrote .env with generated secrets (mode 600)."
echo "Before deploying publicly, set WEB_ORIGIN and GATEWAY_PUBLIC_URL to your https URLs."
