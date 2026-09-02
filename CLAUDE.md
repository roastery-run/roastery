# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## What this is

**Roastery** is a coffee operations platform: green contracts → inventory →
roasting → QC → production planning → orders → fulfilment → cafés. It runs
entirely on Cloudflare Workers with Neon Postgres behind Hyperdrive.

The thing that makes it defensible is the coffee-specific data model — green
lot → roast batch → cupping → roasted lot → blend → order → customer — which a
generic ERP cannot express. Changes that erode that model in favour of
something generic are going the wrong way.

## Monorepo layout

pnpm + Turborepo workspace (`apps/*`, `packages/*`). Node ≥ 20.

```
apps/
  api/       Cloudflare Worker — RPC API, Durable Objects, queues, cron
  web/       React SPA — marketing site + the public /trace/$code QR page
  console/   React SPA — the authenticated product
  docs/      Astro + Starlight — API reference and guides
packages/
  db/        Drizzle schema (split per domain) + migrations + tenancy.ts
  auth/      Better Auth configuration, shared by api and console
  schemas/   Zod schemas shared by the API and both SPAs
  ui/        Design system, consumed as SOURCE (no build step)
  units/     Weight/temperature/currency conversion, no React
  roast-sim/ Deterministic roast simulator
  tsconfig/  Shared bases
```

Shared dependency versions are pinned with **pnpm catalogs**
(`pnpm-workspace.yaml`), so context-holding singletons resolve to one instance.
Reference them as `"catalog:"` in each package.json rather than a literal range.

## Commands

```bash
pnpm check       # Biome lint + format — this is what CI runs
pnpm check:fix   # autofix
pnpm typecheck   # tsc across all workspaces
pnpm test        # turbo test → vitest per workspace
pnpm build       # wrangler dry-run into dist/
```

Run one workspace with `pnpm --filter @roastery/api test`, one file with
`pnpm --filter @roastery/api exec vitest run src/lib/domain/scheduling.test.ts`.

Database workflow: edit `packages/db/src/schema/*.ts` → `pnpm db:generate` →
`pnpm db:migrate`.

---

# Conventions

These are the rules the codebase is already written to. Follow them; when one
of them is wrong, change it here first rather than diverging quietly.

## 1. File organization — directories by CONCERN, never by type

A directory called `lib/`, `utils/`, `helpers/` or `types/` accumulates
everything and tells a reader nothing. Every directory name must answer "what
part of the system is this?"

`apps/api/src` is the reference layout:

```
src/
  index.ts              the Worker entry: fetch, queue, scheduled
  env.ts                bindings and their documentation
  rpc/                  RPC operations, one file per namespace
    catalog/            location.ts, product.ts, party.ts, machine.ts
    inventory/          green.ts, roasted.ts, material.ts, costing.ts
    orders/             orders.ts, shared.ts
    production/         roast.ts, schedule.ts
    quality/            cupping.ts, grading.ts
    sourcing/           contract.ts, sample.ts
    webhooks.ts         single-namespace domains stay flat
    index.ts            mounts every module; the entry imports only this
  http/                 non-RPC HTTP surfaces (machine ingest, streaming)
  queue/                queue consumers
  cron/                 scheduled handlers
  durable-objects/      one file per DO class
  lib/
    api/                RPC plumbing: rpc, authorize, openapi, errors, idempotency, rate-limit
    auth/               credentials, permissions, entitlements, org scoping
    db/                 the database handles and audit
    domain/             the coffee: inventory, costing, roasting, cupping, scheduling
    events/             the outbox, webhook signing and delivery
```

Rules:

- **One file per RPC namespace.** `quality.cupping` and `quality.grading` are
  separate files even though both are "quality", because they answer different
  questions and only one of them writes to inventory.
- **A domain earns a directory** once it has more than one namespace or a
  shared helper module. Before that it stays a flat file: `webhooks/webhooks.ts`
  tells a reader nothing that `webhooks.ts` does not.
- **Shared helpers between two sibling modules go in a third file** in the
  domain that owns the data (`rpc/orders/shared.ts`), never imported sideways
  from one peer into another — that makes the dependency point the wrong way.
- **A barrel per top-level directory** when the consumer would otherwise import
  a dozen siblings (`rpc/index.ts`). Not for `lib/*`, where an explicit path is
  the useful documentation.
- Tests sit next to the code they test (`scheduling.ts` / `scheduling.test.ts`).
  Tests that need a database live in `apps/api/test/`.
- Schema files import in one direction only:
  `enums → auth → oauth → org → webhooks → catalog → inventory → …`. Every
  `pgEnum` lives in `enums.ts`; every `relations()` call lives in
  `relations.ts`. Both rules exist because violating either produces a
  duplicate `CREATE TYPE` or a circular import.

## 2. Authorization is application-layer, and it is enforced by a test

No Postgres RLS. Three cooperating layers:

1. **Middleware** runs before Hono's Zod validators, so authorization always
   precedes body validation. Failure order is deliberate: **401 authn → 403 org
   access → 402 entitlement → 403 permission**. An unauthenticated caller with a
   malformed body must get a 401, never a 400 describing the request schema.
2. **`OrgDb`** is the only way a handler touches tenant data. It does not mirror
   Drizzle's fluent chain: `.where()` is a setter, so any wrapper returning a
   raw builder can have its org predicate silently overwritten. The caller's
   predicate is a parameter and the org clause is `and()`-ed in out of reach.
   The raw handle is called **`unsafeDb`** and there is no `c.var.db`.
3. **Permissions are data** (`permissions`, `roles`, `role_permissions`), not
   constants. New permissions arrive in migrations and are granted explicitly —
   never silently added to existing roles.

`apps/api/test/authorization.test.ts` is the gate and the most valuable file in
the repo. Adding a table means classifying it in `packages/db/src/tenancy.ts`
or the build fails. Adding an operation means registering it via `registerRpc`
with a real permission slug or the build fails.

## 3. Money and weight are exact, never floats

- Weights: `numeric(14,4)` canonical **kilograms**. Money: `numeric(18,4)`
  amounts, `numeric(18,6)` unit prices, `numeric(18,8)` FX.
- Arithmetic goes through the BigInt-based helpers (`kg`, `costMath`), not
  through `Number`. Exact `SUM()` is what makes the ledger auditable.
- Decimal **strings** on the wire. A JSON number is a float by the time it
  reaches a client.
- Store the user's entered value and unit alongside the canonical one, or
  "275 bags" renders forever as "18,975.0000 kg". Bags are not a mass unit —
  the kg factor is per lot.

## 4. Ledgers are truth; cached balances are caches

Every quantity change goes through **one** write path
(`applyInventoryTransaction`, `applyRoastedTransaction`) which, in a single
transaction: takes `SELECT … FOR UPDATE`, inserts the ledger row with a
per-subject monotonic `seq`, and updates the cached balance. A unique index on
`(subject, seq)` is the concurrency guard.

Nothing else may write `current_weight_kg`. Reconciliation **alerts** on drift
rather than silently correcting it — silent correction hides the bug that
caused the drift.

## 5. Every mutation writes to the outbox, in its own transaction

`ctx.db.transaction(tx => { …change…; await tx.emit({…}) })`. The event row
commits with the change, so "the lot moved but no webhook fired" is not a
reachable state. Never emit outside the transaction that made the change, and
never enqueue from inside a handler — the RPC wrapper flushes after the
response, and the cron sweeper covers a lost enqueue.

Event types are a closed enum in `packages/schemas`. Payloads carry the
identifying fields and what changed — a webhook is a notification, not a
replication feed, and every field shipped becomes part of the contract.

## 6. API conventions

- RPC only: `POST /rpc/v1/{namespace}.{operation}`. The console calls the same
  surface as third parties — that is what stops the public API becoming
  second-class.
- Every `list*` takes `{filter?, page?}` and returns `{items, page}`, with
  **keyset pagination** on `(createdAt, id)`. No offsets.
- Every mutation is idempotent and returns the **full mutated resource**, never
  `{ok: true}` — a caller needs something to log and something to show.
- Console-only operations live in a `console.*` namespace marked
  `internal: true`: in the spec and typed, filtered from the public docs.
- Errors are one envelope: `{error, code, fields?}`.

## 7. Comments explain WHY, and only where the reason is not obvious

The bar: would a competent engineer reading this line wonder why it is written
this way? If yes, say why — especially where the obvious implementation is
wrong (FEFO vs FIFO, decaf last, MAD vs standard deviation, per-batch machine
assignment vs pinning). If no, write nothing. Do not narrate what the code
plainly does, and do not leave a comment that restates the function name.

Match the surrounding density. A file with a paragraph at the top and terse
bodies should not gain a paragraph per line.

## 8. Failure modes to design against

These are the ones this codebase has already been bitten by; assume the next
feature can hit them too.

- **Alert spam.** An alerting system fails not by missing an alert but by
  sending the same one every morning until someone mutes the channel. Dedupe on
  `(rule, subject, day)` with a unique index, not with a check the sender might
  skip.
- **Silent partial success.** A partial allocation, a half-received shipment or
  a schedule that covers less than was ordered must be reported as such, never
  returned looking like success.
- **Retrying what will never work.** A 404 from a deleted route is not
  transient. Distinguish transient from permanent before retrying.
- **A cache that outlives a revocation.** Authorization reads and all writes use
  the cache-disabled Hyperdrive. The query cache does not participate in
  transactions.
- **Losing a person behind a credential.** An API key that a human created acts
  for that human; `Actor` carries both `id` (the credential) and `userId` (the
  person). Conflating them collapsed three cuppers into one score.

## 9. Tooling

- **Biome** (not ESLint/Prettier): 2-space indent, 100 columns, double quotes,
  semicolons, trailing commas. `packages/db/drizzle/` is generated — never
  hand-edit it.
- **TypeScript, Zod 4, Hono 4, ESM** throughout. Import types from
  `@roastery/schemas` and `@roastery/db` rather than redefining them.
- Prefer a pure function with a unit test over a method that needs a database.
  The scheduling, costing, cupping-aggregation and retry-policy logic are all
  pure for exactly this reason.
