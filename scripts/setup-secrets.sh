#!/usr/bin/env bash
set -euo pipefail

# Worker secrets for a deployed environment.
#
#   scripts/setup-secrets.sh staging
#   scripts/setup-secrets.sh production
#
# Values come from apps/api/.<environment>.vars, which is gitignored. An
# environment-suffixed name (BETTER_AUTH_SECRET_PRODUCTION) wins over the bare
# name, so .dev.vars-style local credentials — a localhost OAuth app, a dev
# mail key — can never reach a deployed Worker by being the only value present.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ENVIRONMENT="${1:-}"
case "$ENVIRONMENT" in
  staging | production) ;;
  *)
    echo "usage: $(basename "$0") <staging|production>"
    exit 1
    ;;
esac

VARS="$ROOT/apps/api/.$ENVIRONMENT.vars"
CONFIG="wrangler.$ENVIRONMENT.jsonc"
SUFFIX="$(echo "$ENVIRONMENT" | tr '[:lower:]' '[:upper:]')"

if [[ ! -f "$VARS" ]]; then
  echo "Missing $VARS — see $(basename "$0") for the keys it needs."
  exit 1
fi

cd "$ROOT/apps/api"

put_secret() {
  local name="$1" value
  value="$(grep -E "^${name}_${SUFFIX}=" "$VARS" | cut -d= -f2- || true)"
  [[ -z "$value" ]] && value="$(grep -E "^${name}=" "$VARS" | cut -d= -f2- || true)"
  if [[ -z "$value" ]]; then
    echo "skip $name (not in $VARS)"
    return 0
  fi
  # A localhost value in a deployed secret is always a mistake: an OAuth app
  # registered against localhost, or a mail endpoint that does not resolve from
  # a Worker. Both fail at the worst moment — the first sign-in.
  if [[ "$value" == *localhost* || "$value" == *127.0.0.1* ]]; then
    echo "refuse $name: value points at localhost, which cannot work from a deployed Worker"
    exit 1
  fi
  printf '%s' "$value" | pnpm exec wrangler secret put "$name" --config "$CONFIG" >/dev/null
  echo "set  $name"
}

# Required.
put_secret BETTER_AUTH_SECRET
put_secret WEBHOOK_KEK

# Required for mail. Both environments send through the Cloudflare `send_email`
# binding declared in their wrangler config, so only the From address is a
# secret — EMAIL_API_URL and EMAIL_API_KEY are the fallback for an HTTPS
# provider and are normally unset.
put_secret EMAIL_FROM

# Optional: an HTTPS provider instead of the binding.
put_secret EMAIL_API_URL
put_secret EMAIL_API_KEY
put_secret GITHUB_CLIENT_ID
put_secret GITHUB_CLIENT_SECRET
put_secret GOOGLE_CLIENT_ID
put_secret GOOGLE_CLIENT_SECRET
put_secret SSO_PROVIDER_ID
put_secret SSO_CLIENT_ID
put_secret SSO_CLIENT_SECRET
put_secret SSO_DISCOVERY_URL
put_secret SSO_SCOPES

echo "Secrets set for $ENVIRONMENT."
