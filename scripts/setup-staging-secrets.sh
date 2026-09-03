#!/usr/bin/env bash
set -euo pipefail

# Worker secrets for staging.
#
# Values come from apps/api/.staging.vars, which is gitignored. A `_STAGING`
# suffix wins over the bare name, so .dev.vars-style local credentials (a
# localhost OAuth app, a dev mail key) can never reach a deployed Worker by
# being the only value present.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VARS="$ROOT/apps/api/.staging.vars"
CONFIG="wrangler.staging.jsonc"

if [[ ! -f "$VARS" ]]; then
  echo "Missing $VARS — see scripts/setup-staging-secrets.sh for the keys it needs."
  exit 1
fi

cd "$ROOT/apps/api"

put_secret() {
  local name="$1" value
  value="$(grep -E "^${name}_STAGING=" "$VARS" | cut -d= -f2- || true)"
  [[ -z "$value" ]] && value="$(grep -E "^${name}=" "$VARS" | cut -d= -f2- || true)"
  if [[ -z "$value" ]]; then
    echo "skip $name (not in $VARS)"
    return 0
  fi
  printf '%s' "$value" | pnpm exec wrangler secret put "$name" --config "$CONFIG" >/dev/null
  echo "set  $name"
}

# Required.
put_secret BETTER_AUTH_SECRET
put_secret WEBHOOK_KEK

# Required for mail. Staging sends through the Cloudflare `send_email` binding
# declared in wrangler.staging.jsonc, so only the From address is a secret —
# EMAIL_API_URL and EMAIL_API_KEY are the fallback for an HTTPS provider and
# are unset here.
put_secret EMAIL_FROM

# Optional: an HTTPS provider instead of the binding.
put_secret EMAIL_API_URL
put_secret EMAIL_API_KEY
put_secret GITHUB_CLIENT_ID
put_secret GITHUB_CLIENT_SECRET
put_secret GOOGLE_CLIENT_ID
put_secret GOOGLE_CLIENT_SECRET
