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

echo "==> Gate"
pnpm check
pnpm typecheck
pnpm test

echo "==> Migrating the staging database"
# DATABASE_URL must point at the Neon `staging` branch. The authz seed re-runs
# on every migrate, so permissions added since the last deploy actually arrive.
pnpm db:migrate

echo "==> api"
pnpm --filter @roastery/api exec wrangler deploy --config wrangler.staging.jsonc

echo "==> web, console, docs"
pnpm --filter @roastery/web build
pnpm --filter @roastery/web exec wrangler deploy --config wrangler.staging.jsonc
pnpm --filter @roastery/console build
pnpm --filter @roastery/console exec wrangler deploy --config wrangler.staging.jsonc
pnpm --filter @roastery/docs build
pnpm --filter @roastery/docs exec wrangler deploy --config wrangler.staging.jsonc

echo "==> Deployed"
echo "    https://api-staging.roastery.run/health"
echo "    https://staging.roastery.run"
echo "    https://app-staging.roastery.run"
echo "    https://docs-staging.roastery.run"
