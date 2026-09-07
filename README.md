# ROASTERY

A coffee operations platform: green contracts → inventory → roasting → QC →
production planning → orders → fulfilment → cafés.

The thing that makes it defensible is the coffee-specific data model — green
lot → roast batch → cupping → roasted lot → blend → order → customer — which a
generic ERP cannot express. The rest of the system exists to make that model
usable and auditable: every quantity is a ledger entry, every balance can be
opened into the entries that produced it, and every mutation emits an event in
the same transaction that made the change.

It runs entirely on Cloudflare Workers with Neon Postgres behind Hyperdrive.

| Surface | What it is | Production |
| --- | --- | --- |
| `apps/api` | The Worker: RPC API, Durable Objects, queues, cron | `api.roastery.run` |
| `apps/console` | The authenticated product, a client-only React SPA | `app.roastery.run` |
| `apps/web` | Marketing, and the `/trace/$code` QR page, server-rendered | `roastery.run` |
| `apps/docs` | Generated API reference and hand-written guides | `docs.roastery.run` |

## Requirements

- Node ≥ 22.18 — `.node-version` pins 22.18.0, and `engine-strict` refuses an
  install below it because a build step relies on Node's type stripping.
- pnpm 10.34.5 (`corepack enable` is enough).
- Docker, for Neon Local.
- A Neon account: local dev runs against a real ephemeral Neon branch rather
  than a stand-in Postgres, so Hyperdrive, partitioning and the extensions
  behave the same as in production.

## Getting started

```bash
pnpm install
pnpm setup:local     # writes .env, apps/api/.dev.vars, wrangler.local.jsonc
```

Then put a `NEON_API_KEY`, `NEON_PROJECT_ID` and `NEON_PARENT_BRANCH_ID` in
`.env` (the API key comes from
[Neon → Settings → API keys](https://console.neon.tech/app/settings/api-keys)),
and bring the database up:

```bash
pnpm db:up           # Neon Local: an ephemeral branch, proxied at :5432
pnpm db:migrate
pnpm dev             # every app, in parallel
```

| | |
| --- | --- |
| API | http://localhost:8787 |
| Console | http://localhost:5174 |
| Web | http://localhost:5173 |
| API reference | http://localhost:8787/docs |
| Docs site | http://localhost:4321 |

`pnpm db:down` stops the proxy, and the ephemeral branch is deleted with it —
each run starts from a clean copy of the parent branch rather than from
whatever the last person left behind. Run one app on its own with
`pnpm dev:api`, or `pnpm --filter @roastery/console dev`.

To sign in you need an organization, because every operation is org-scoped and
the first one cannot be created through an API that requires it to exist. See
[`ops/runbooks/onboarding.md`](ops/runbooks/onboarding.md); it is one command.

## Commands

```bash
pnpm check       # Biome lint + format — this is what CI runs
pnpm check:fix   # autofix
pnpm typecheck   # tsc across all workspaces
pnpm test        # turbo test → vitest per workspace
pnpm build       # wrangler dry-run into dist/
```

Scope any of them to a workspace with `--filter`, and a single file through the
workspace's own vitest:

```bash
pnpm --filter @roastery/api test
pnpm --filter @roastery/api exec vitest run src/lib/domain/scheduling.test.ts
```

Tests that need a database read `TEST_DATABASE_URL`. Without it they skip — and
a skipped suite still reports green, which is why `integration test wiring`
fails the run when `CI` is set and that database is missing.

Changing the schema is always three steps: edit
`packages/db/src/schema/*.ts`, `pnpm db:generate`, `pnpm db:migrate`. CI
regenerates and fails if the result differs, because a schema change without a
migration typechecks, passes every test, and fails in production as `column
does not exist`.

## Layout

pnpm + Turborepo workspace. Shared dependency versions are pinned with pnpm
catalogs in `pnpm-workspace.yaml` and referenced as `"catalog:"`, so
context-holding singletons — the router, the query client, `sonner` — resolve
to exactly one instance.

```
apps/
  api/       Cloudflare Worker — RPC API, Durable Objects, queues, cron
  web/       TanStack Start (SSR) — marketing + the public /trace/$code page
  console/   React SPA (client-only) — the authenticated product
  docs/      Astro + Starlight — generated API reference and guides
packages/
  db/        Drizzle schema (split per domain) + migrations + tenancy.ts
  auth/      Better Auth configuration, shared by api and console
  schemas/   Zod schemas shared by the API and both SPAs
  ui/        Design system, consumed as SOURCE (no build step)
  units/     Weight/temperature/currency conversion, no React
  roast-sim/ Deterministic roast simulator
  tsconfig/  Shared bases
ops/runbooks/ Deploying, rolling back, restoring, onboarding
scripts/     Deploy and setup scripts, plus the CI config checks
```

## Using the API

RPC only, over `POST /rpc/v1/{namespace}.{operation}`. The console calls the
same surface as a third party does, which is what stops the public API becoming
second-class.

```bash
curl -s https://api.roastery.run/rpc/v1/inventory.green.listGreenLots \
  -X POST -H 'content-type: application/json' \
  -H "Authorization: Bearer $ROASTERY_API_KEY" \
  -H "X-Roastery-Org: $ORG_ID" \
  -d '{"page":{"limit":20}}'
```

Every `list*` takes `{filter?, page?}` and returns `{items, page}` with keyset
pagination; every mutation is idempotent and returns the full mutated resource;
every error is one envelope, `{error, code, fields?}`. The generated reference
lives at [docs.roastery.run](https://docs.roastery.run); the Worker serves the
same document interactively at `/docs`, and the machine-readable spec at
`/openapi.public.json`.

## Deploying

Staging deploys itself on every push to `main`. Production is dispatched by a
person and gated on the `production` GitHub environment: migrate, ship a new
version, 10% canary with `/health` polled for five minutes, then 100%.
[`ops/runbooks/deploy.md`](ops/runbooks/deploy.md) has the detail, including
what to do when a release adds a Durable Object migration.

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — how a request flows, and the four
  invariants the system is built on.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — workflow, what CI enforces, and what a
  reviewer will look for.
- [`CLAUDE.md`](CLAUDE.md) — the conventions the codebase is already written to.
  Written for coding agents, but it is the most direct statement of the rules.
- [`PRODUCT.md`](PRODUCT.md) — who the four users are and what the product is
  arguing. Read before designing a screen.
- [`DESIGN.md`](DESIGN.md) — the Kiln design system: palette, type, elevation,
  component specs.
- [`ops/`](ops/) — runbooks.
- [`SECURITY.md`](SECURITY.md) — reporting a vulnerability.
