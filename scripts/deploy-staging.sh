#!/usr/bin/env bash
set -euo pipefail

# Deploys every surface to staging, API first.
#
# Order is not cosmetic: the console and the marketing site both read the API,
# and the API owns the CORS allowlist that admits them. Deploying a front end
# against an API that does not yet know its origin produces a site that loads
# and then fails every request, which reads as a broken build rather than a
# deploy ordering problem.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Wrangler prefers CF_API_TOKEN / CLOUDFLARE_API_TOKEN over the OAuth login in
# ~/Library/Preferences/.wrangler, silently. A scoped token that is missing one
# permission then fails only the operations needing it — Hyperdrive returned a
# bare "Authentication error [code: 10000]" while Queues, KV, R2 and Workers
# all worked, which reads as a broken product rather than a missing scope.
# Unset here so a deploy uses the interactive login unless a token is passed
# deliberately.
if [[ -z "${USE_CF_API_TOKEN:-}" ]]; then
  unset CF_API_TOKEN CLOUDFLARE_API_TOKEN
fi

echo "==> Gate"
pnpm check
pnpm typecheck
pnpm test

echo "==> Checking the configs"
node scripts/check-deploy-config.mjs \
  apps/api/wrangler.staging.jsonc \
  apps/web/wrangler.staging.jsonc \
  apps/console/wrangler.staging.jsonc \
  apps/docs/wrangler.staging.jsonc

echo "==> Migrating the staging database"
# `--target staging` compares DATABASE_URL's host against the staging Neon
# endpoint and refuses if it points somewhere else, so an exported production
# URL cannot be migrated by a staging deploy. The authz seed re-runs on every
# migrate, so permissions added since the last deploy actually arrive.
pnpm --filter @roastery/db migrate --target staging

echo "==> api"
pnpm --filter @roastery/api exec wrangler deploy --config wrangler.staging.jsonc

echo "==> web, console, docs"
# --mode staging selects .env.staging. Without it Vite uses "production" mode
# for a build, which here would silently bake production URLs into the staging
# site — or, with no env file at all, localhost.
pnpm --filter @roastery/web exec vite build --mode staging
node scripts/verify-build-env.mjs apps/web/dist/client staging
pnpm --filter @roastery/web exec wrangler deploy --config wrangler.staging.jsonc
pnpm --filter @roastery/console exec vite build --mode staging
node scripts/verify-build-env.mjs apps/console/dist staging
pnpm --filter @roastery/console exec wrangler deploy --config wrangler.staging.jsonc
# API_URL is what the reference is GENERATED from, and it was unset — so a
# staging docs build regenerated against localhost, failed, and silently
# published the checked-in snapshot instead. Pointed at the API that was just
# deployed above, the reference describes what is actually running.
DOCS_URL=https://docs-staging.roastery.run \
  API_PUBLIC_URL=https://api-staging.roastery.run \
  API_URL=https://api-staging.roastery.run \
  pnpm --filter @roastery/docs build
pnpm --filter @roastery/docs exec wrangler deploy --config wrangler.staging.jsonc

echo "==> Deployed"
echo "    https://api-staging.roastery.run/health"
echo "    https://staging.roastery.run"
echo "    https://app-staging.roastery.run"
echo "    https://docs-staging.roastery.run"
