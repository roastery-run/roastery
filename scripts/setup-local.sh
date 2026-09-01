#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  SECRET="$(openssl rand -base64 32)"
  sed -i.bak "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$SECRET|" "$ROOT/.env"
  rm -f "$ROOT/.env.bak"
  echo "Created .env (set DATABASE_URL and OAuth credentials)"
fi

if [ ! -f "$ROOT/apps/api/.dev.vars" ]; then
  cp "$ROOT/apps/api/.dev.vars.example" "$ROOT/apps/api/.dev.vars"
  SECRET="$(grep -E '^BETTER_AUTH_SECRET=' "$ROOT/.env" | cut -d= -f2-)"
  sed -i.bak "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$SECRET|" "$ROOT/apps/api/.dev.vars"
  rm -f "$ROOT/apps/api/.dev.vars.bak"
  echo "Created apps/api/.dev.vars"
fi

if [ ! -f "$ROOT/apps/api/wrangler.local.jsonc" ]; then
  cp "$ROOT/apps/api/wrangler.local.jsonc.example" "$ROOT/apps/api/wrangler.local.jsonc"
  DB_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | cut -d= -f2- || true)"
  if [ -n "$DB_URL" ]; then
    python3 - "$ROOT/apps/api/wrangler.local.jsonc" "$DB_URL" <<'PY'
import json, sys
path, url = sys.argv[1], sys.argv[2]
with open(path) as f:
    cfg = json.load(f)
# wrangler's multi-config merge does not inherit these from the base file.
cfg["main"] = "src/index.ts"
cfg["compatibility_date"] = "2025-09-01"
cfg["compatibility_flags"] = ["nodejs_compat"]
cfg["hyperdrive"][0]["localConnectionString"] = url
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
PY
  fi
  echo "Created apps/api/wrangler.local.jsonc"
fi

echo "Local setup complete. Next: pnpm db:up && pnpm db:migrate"
