#!/usr/bin/env bash
set -euo pipefail

# Deploys every surface to production.
#
# Differs from staging in one way that matters: the API goes out as a VERSION
# first, takes 10% of traffic, is watched, and only then takes all of it. A
# Worker deploy is otherwise an instant 100% cutover with no undo, and by the
# time it is running the database has already been migrated — so "roll back the
# deploy" is not available as a first response unless the release was split.
#
# Rollback is `wrangler versions deploy <previous-version-id>@100`, which is why
# the previous version id is printed before anything shifts.
#
# One caveat, deliberately not automated: a release whose wrangler config adds a
# Durable Object migration tag CANNOT be split this way — both versions would
# have to agree about the DO class. Deploy those with ROLLOUT=100.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CONFIG="wrangler.production.jsonc"
ROLLOUT="${ROLLOUT:-10}"
API="https://api.roastery.run"

# Wrangler prefers CF_API_TOKEN / CLOUDFLARE_API_TOKEN over the OAuth login,
# silently, and a token missing one scope fails only the operations needing it —
# Hyperdrive returned a bare "Authentication error [code: 10000]" while
# everything else worked. In CI the token is the point, so it is kept.
if [[ -z "${USE_CF_API_TOKEN:-}" && -z "${CI:-}" ]]; then
  unset CF_API_TOKEN CLOUDFLARE_API_TOKEN
fi

echo "==> Gate"
pnpm check
pnpm typecheck
pnpm test

echo "==> Checking the configs"
node scripts/check-deploy-config.mjs \
  apps/api/wrangler.production.jsonc \
  apps/web/wrangler.production.jsonc \
  apps/console/wrangler.production.jsonc \
  apps/docs/wrangler.production.jsonc

echo "==> Migrating the production database"
# Expand-only, enforced in CI: the version still serving traffic during the
# rollout below is the OLD one, and it has to keep working against this schema.
pnpm --filter @roastery/db migrate --target production

echo "==> api: uploading a version"
PREVIOUS="$(pnpm --filter @roastery/api exec wrangler deployments list --config "$CONFIG" --json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);console.log(d?.[0]?.versions?.[0]?.version_id ?? "")})' || true)"
echo "    rollback target: ${PREVIOUS:-unknown}"

VERSION="$(pnpm --filter @roastery/api exec wrangler versions upload --config "$CONFIG" --json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).id)})')"
echo "    uploaded $VERSION"

if [[ "$ROLLOUT" == "100" ]]; then
  pnpm --filter @roastery/api exec wrangler versions deploy "$VERSION@100" --config "$CONFIG" --yes
else
  echo "==> api: $ROLLOUT% of traffic"
  pnpm --filter @roastery/api exec wrangler versions deploy \
    "$VERSION@$ROLLOUT" "${PREVIOUS}@$((100 - ROLLOUT))" --config "$CONFIG" --yes

  echo "==> watching for 5 minutes"
  # A canary nobody looks at is a slower way to break production. /health is
  # cheap and hits the database, so a bad binding shows up here rather than in
  # the first customer's request.
  for _ in $(seq 1 10); do
    sleep 30
    code="$(curl -s -o /dev/null -w '%{http_code}' "$API/health")"
    if [[ "$code" != "200" ]]; then
      echo "    /health returned $code — rolling back to ${PREVIOUS:-previous}"
      [[ -n "$PREVIOUS" ]] && pnpm --filter @roastery/api exec wrangler versions deploy \
        "${PREVIOUS}@100" --config "$CONFIG" --yes
      exit 1
    fi
    echo "    ok"
  done

  echo "==> api: 100%"
  pnpm --filter @roastery/api exec wrangler versions deploy "$VERSION@100" --config "$CONFIG" --yes
fi

echo "==> web, console, docs"
# --mode production selects .env.production. The gate above rebuilds nothing,
# but turbo's test task depends on build, so the artifact is verified rather
# than the command.
pnpm --filter @roastery/web exec vite build --mode production
node scripts/verify-build-env.mjs apps/web/dist/client production
pnpm --filter @roastery/web exec wrangler deploy --config "$CONFIG"
pnpm --filter @roastery/console exec vite build --mode production
node scripts/verify-build-env.mjs apps/console/dist production
pnpm --filter @roastery/console exec wrangler deploy --config "$CONFIG"
DOCS_URL=https://docs.roastery.run \
  API_PUBLIC_URL=https://api.roastery.run \
  API_URL=https://api.roastery.run \
  pnpm --filter @roastery/docs build
pnpm --filter @roastery/docs exec wrangler deploy --config "$CONFIG"

echo "==> Deployed"
echo "    rollback: wrangler versions deploy ${PREVIOUS:-<previous>}@100 --config $CONFIG"
echo "    https://api.roastery.run/health"
echo "    https://roastery.run"
echo "    https://app.roastery.run"
echo "    https://docs.roastery.run"
