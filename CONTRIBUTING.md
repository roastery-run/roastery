# Contributing

## Setup

[`README.md`](README.md) has it: `pnpm install`, `pnpm setup:local`, Neon
credentials in `.env`, then `pnpm db:up && pnpm db:migrate && pnpm dev`.

## Before you push

```bash
pnpm check && pnpm typecheck && pnpm test
```

Those three are what CI runs first, and running them locally is faster than
finding out from a red build. If a change touched the schema, add
`pnpm db:generate` and commit the migration it produces.

Tests that need a database read `TEST_DATABASE_URL`. Point it at the Neon Local
proxy — `postgresql://neon:npg@localhost:5432/neondb` — or any throwaway
Postgres. Without it they skip silently, so a green local run does not
necessarily mean the ledger invariants were checked.

## What CI enforces

Two jobs, in `.github/workflows/ci.yml`.

**`lint-build`** runs `pnpm check`, `pnpm typecheck` and `pnpm build`, then two
checks that exist because of specific production failures:

- *Migrations match the schema.* It regenerates and fails if the working tree
  changes. A schema edit without a migration typechecks, passes every test, and
  fails in production as `column does not exist`. Only the generator can tell.
- *Migrations are expand-only.* Deploys migrate before traffic shifts, and a
  gradual rollout runs two versions at once, so a migration that drops or
  retypes a column breaks the release still serving. To remove a column: ship
  the code that stops using it in one release, drop it in the next. A genuine
  contract migration is marked in the SQL and cannot be split —

  ```sql
  -- contract: approved — dropped in v42, unused since v41
  ```

**`test`** runs the whole suite against a real Postgres 17 service. It is a
service rather than a stub because a skipped suite still reports green, which
is exactly how an unverified invariant reaches production.

Two of the tests are gates rather than coverage, and they fail the build by
design:

- `apps/api/test/authorization.test.ts` enumerates the schema and every
  registered operation. **Adding a table means classifying it in
  `packages/db/src/tenancy.ts`**, and **adding an operation means registering
  it via `registerRpc` with a real permission slug**, or the build fails.
- `packages/ui/src/lib/tokens.test.ts` parses `styles.css` and checks every
  foreground/background pair against WCAG AA, plus lightness separation between
  chart series. A comment claiming "AA verified" rots the moment someone nudges
  a token.

## Conventions

[`CLAUDE.md`](CLAUDE.md) is the full statement and is worth reading once
end to end. The rules that come up most in review:

- **Directories are named for a concern, never a type.** No new `utils/`,
  `helpers/` or `types/`. A domain earns a directory once it has more than one
  namespace or a shared helper; before that it stays a flat file.
- **One file per RPC namespace.** Shared helpers between two siblings go in a
  third file in the domain that owns the data, never imported sideways from one
  peer into another.
- **Tenant data is reached through `OrgDb`.** The raw handle is `unsafeDb` and
  using it needs a reason a reviewer will accept.
- **Money and weight are exact**: numeric columns, BigInt helpers, decimal
  strings on the wire. Never `Number`.
- **Quantity changes go through the one ledger write path**, and nothing else
  writes a cached balance.
- **Mutations emit to the outbox inside the same transaction**, and never
  enqueue from a handler.
- **Every `list*` is `{filter?, page?}` → `{items, page}`** with keyset
  pagination on `(createdAt, id)`. No offsets. Every mutation is idempotent and
  returns the full mutated resource.
- **Partial success is reported as partial.** A half allocation or a short
  receipt must not return looking like success.
- **Comments say why, and only where the reason is not obvious.** Match the
  density of the file you are in; do not restate the function name.
- **The wordmark is ROASTERY**, uppercase, wherever a person reads it.
  Machine-facing spellings — `@roastery/*`, `X-Roastery-Org`, `roastery.run` —
  are contracts and stay as they are.
- Tests sit next to the code they test; anything needing a database goes in
  `apps/api/test/`.
- Prefer a pure function with a unit test over a method that needs a database.
  Scheduling, costing, cupping aggregation and retry policy are all pure for
  this reason.

When one of these rules is wrong, change it in `CLAUDE.md` in the same PR
rather than diverging quietly.

## Design changes

Read [`PRODUCT.md`](PRODUCT.md) before designing a screen — it names the four
users, where each of them is standing, and the four anti-references — and
[`DESIGN.md`](DESIGN.md) for the visual system. `styles.css` and
`tokens.test.ts` remain the source of truth for token values; DESIGN.md
explains them.

shadcn components are vendored into `packages/ui/src/ui` and we own them. After
`shadcn add`, run `pnpm --filter @roastery/ui normalize` — the CLI writes `@/…`
imports and this package is consumed as source, so `@/` would otherwise resolve
to the *consuming* app's src — then `pnpm check:fix`.

## Pull requests

Branch off `main`; branch names in this repo read `area/what-it-does`
(`inventory/ledger-pagination`, `console/inventory-operability`).

Say in the description what changes for a user of the system, and why the
approach is the one you took — a reviewer can read the diff, but not the option
you rejected. Call out anything that touches the ledger write path, the
authorization layers, an event payload, or a migration, since each of those is
a contract someone else depends on.

Commit subjects here read as a sentence about what changed for the system —
"Let the ledger show the whole history", "Give the deploy gate a database" —
rather than as a category prefix. PRs merge to `main` through GitHub, usually
as a single commit's worth of work. Merging deploys to staging automatically,
so `main` is expected to be shippable at all times.

## Generated files, which are never edited by hand

- `packages/db/drizzle/` — from `pnpm db:generate`.
- `apps/docs/src/content/docs/reference/` — from the OpenAPI document at build
  time, and not committed.
- `.astro/`, `dist/`, `.wrangler/`, `apps/web/.output/`.

Anything generated has a test asserting it still matches its source; see
`partitioning.test.ts` and `pricing.test.ts`.

## Deploying

You do not deploy from a laptop. Staging ships itself on every push to `main`;
production is dispatched from Actions and gated on an environment approval, so
the audit trail exists whether or not anyone remembers to keep one. See
[`ops/runbooks/deploy.md`](ops/runbooks/deploy.md), and
[`ops/runbooks/rollback.md`](ops/runbooks/rollback.md) for when it goes wrong.
