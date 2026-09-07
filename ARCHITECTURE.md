# Architecture

How ROASTERY is put together, and why. This is the runtime picture;
[`CLAUDE.md`](CLAUDE.md) holds the conventions that code is written to, and
neither repeats the other.

## The shape

Everything is a Cloudflare Worker in front of one Neon Postgres database.

```
                  roastery.run          app.roastery.run     docs.roastery.run
                  apps/web (SSR)        apps/console (SPA)   apps/docs
                        │                      │                   │
                        └──────────────┬───────┘                   │
                                       │  POST /rpc/v1/…           │ reads
                                       ▼                           │ openapi.public.json
                            api.roastery.run — apps/api ◄──────────┘
                                       │
        ┌──────────────┬───────────────┼──────────────┬─────────────────┐
        ▼              ▼               ▼              ▼                 ▼
   Hyperdrive      Durable         Queues          KV / R2        Rate limiters
        │          Objects      events, webhooks,  sessions,      eight namespaces
        ▼        RoastBatchDO    shots, reports,   curves
   Neon Postgres  CafeSiteDO     maintenance
```

Three client apps and one API. The console calls the same RPC surface a third
party does — there is no private back channel — which is what keeps the public
API from becoming second-class.

## The API surface

| Path | Who calls it | How it authenticates |
| --- | --- | --- |
| `/api/auth/*` | Browsers | Better Auth: magic link, OAuth, sessions |
| `/session/v1/*` | Signed-in browsers | Session, **not** org-scoped |
| `/rpc/v1/*` | Console and integrators | Session or API key, org-scoped |
| `/ingest/v1/*` | Roasters, café bridges | Bridge token, straight to a DO |
| `/stream/v1/*` | Live views | WebSocket upgrade, authenticated |
| `/trace/v1/*`, `/reports/v1/*` | Anyone with the link | Unguessable token / expiring signature |

`/session/v1` sits above the org middleware on purpose: "which organizations
may I act in?" has no organization to scope to. Everything under `/rpc/v1`
requires a tenant.

Machine telemetry is deliberately not RPC. It carries a different credential,
touches no database on the hot path, and needs a rate budget two orders of
magnitude higher — which is why it has its own limiter namespace rather than a
bigger number on the shared one.

## A request, in order

Middleware order is load-bearing, and `apps/api/src/index.ts` is where it is
declared.

1. **Rate limit**, from the namespace that matches the surface. The limit a
   Worker actually enforces comes from the `ratelimits` binding config, not
   from the call site.
2. **Authenticate** (`authMiddleware`) → 401. `Actor` carries both `id`, the
   credential, and `userId`, the person behind it; an API key a human created
   acts for that human.
3. **Resolve the org** (`orgScope`) from `X-Roastery-Org` → 403.
4. **Check entitlement** — is this module on the org's plan? → 402.
5. **Check permission** — the slug the operation registered → 403.
6. **Validate the body** with Zod → 400.

The failure order is the point: an unauthenticated caller sending a malformed
body must get a 401, never a 400 that describes the request schema. Zod runs
inside the route, so anything that must precede validation has to be
middleware.

Responses default to `Cache-Control: no-store`; caching is opt-in per handler.
For a multi-tenant API that is the only safe default.

## Four invariants

Most of the system's rules exist to protect one of these.

**Tenancy is application-layer, and a test is the enforcement.** There is no
Postgres RLS. Handlers reach tenant data only through `OrgDb`, which does not
mirror Drizzle's fluent chain — `.where()` is a setter, so a wrapper returning
a raw builder could have its org predicate silently overwritten. The caller's
predicate is a parameter and the org clause is `and()`-ed in out of reach. The
raw handle is named `unsafeDb`, and there is no `c.var.db` at all.

Every table is classified once in `packages/db/src/tenancy.ts` — scoped by its
own column, scoped through one parent FK, or global — and
`apps/api/test/authorization.test.ts` enumerates the schema and fails the build
on any table that is missing or classified twice. Remembering to write a
predicate in each of ~200 handlers does not survive a 79-table schema;
classifying each table once does. Permissions are rows, not constants: new ones
arrive in migrations and are granted explicitly.

**Ledgers are truth; cached balances are caches.** Every quantity change goes
through one write path — `applyInventoryTransaction`, `applyRoastedTransaction`
— which in a single transaction takes `SELECT … FOR UPDATE`, inserts a ledger
row with a per-subject monotonic `seq`, and updates the cached balance. A
unique index on `(subject, seq)` is the concurrency guard. Nothing else writes
`current_weight_kg`. Nightly reconciliation **alerts** on drift instead of
correcting it, because silent correction hides the bug that caused it.

**Money and weight are exact.** Weights are `numeric(14,4)` canonical
kilograms, money `numeric(18,4)`, unit prices `numeric(18,6)`, FX
`numeric(18,8)`. Arithmetic goes through BigInt helpers, never `Number`, and
decimal **strings** go on the wire — a JSON number is a float by the time it
reaches a client. The user's entered value and unit are stored alongside the
canonical one, so "275 bags" does not render forever as "18,975.0000 kg".

**Every mutation writes to the outbox, in its own transaction.** The event row
commits with the change, so "the lot moved but no webhook fired" is not a
reachable state. Nothing is enqueued from inside a handler: the RPC wrapper
flushes after the response, and a cron sweeper running every minute covers a
lost enqueue. Event types are a closed enum in `packages/schemas`, and every
field shipped in a payload becomes part of the contract.

## Beyond the request

**Durable Objects, where cardinality earns one.** `RoastBatchDO` is one live
roast: a twelve-minute session with a single writer and several people
watching, all of its value in the live curve. It stores to SQLite because an
object can be evicted mid-roast, uses hibernatable sockets so twenty idle
tablets do not bill twelve minutes each, and coalesces 2 Hz samples onto a
250 ms frame. `CafeSiteDO` is one per **site**, not per machine: a shot is over
before anyone looks, so an object per machine would be thousands of objects
handling one write every few minutes. It is a live view and never the system of
record — losing it costs a dashboard, not data.

**Queues, one per shape of work.** Events fan out in batches of 50 because the
work is cheap and idempotent; webhooks batch 10 because each is one outbound
request and concurrency provides the throughput; shots batch 100 into a single
upsert; reports run one per message because rendering is slow and a bad report
should not take nine good ones with it. Each has a dead-letter queue.

**Cron.** Every minute, the outbox sweeper. Nightly, reconciliation fans out
one message per org, and the `espresso_shots` partition window is kept ahead of
real time. Each morning, one alert digest per organization — an alerting system
fails by being muted, so alerts dedupe on `(rule, subject, day)` with a unique
index rather than on the sender remembering to check.

**Background work needs its own connection.** A request's database handle is
closed when the response is sent, so anything continuing in `waitUntil` loses
it mid-query. Long work goes on a queue, with a connection it closes in
`finally`. Authorization reads and all writes use the cache-disabled Hyperdrive
config, because a cache that outlives a revocation is a security bug and the
query cache does not participate in transactions.

## The frontend split

The split between the three apps is load-bearing, not a preference.

`apps/web` is server-rendered because `/trace/$code` is the QR target on retail
bags — the most-loaded page in the system, opened on a phone on a bad
connection and shared as a link. Client-rendered, it would download a
framework, boot it, fetch the certificate and only then paint, and a social
scraper would see an empty shell.

`apps/console` is client-only: it is behind auth, must never be indexed, and
gains nothing from a render it cannot cache. Console-only weight — TanStack
Table, the virtualizer, uPlot — must never reach `web`, and
`apps/web/src/bundle.test.ts` reads the built output to prove it, because
tree-shaking is what actually decides and only the bundler knows.

`packages/ui` is consumed as **source**, with no build step, so both apps
compile it under their own config. That is why shadcn's `@/…` imports have to
be rewritten after `shadcn add` — at compile time `@/` resolves to the
*consuming* app's src.

## Where things live

- `apps/api/src/rpc/**` — one file per RPC namespace; `index.ts` mounts them.
- `apps/api/src/lib/domain/**` — the coffee. Scheduling, costing, cupping
  aggregation and retry policy are pure functions with unit tests, because a
  pure function with a test beats a method that needs a database.
- `apps/api/test/**` — anything that needs a real Postgres.
  `authorization.test.ts` is the gate.
- `packages/db/src/schema/**` — one file per domain, imported in one direction
  (`enums → auth → oauth → org → webhooks → catalog → inventory → …`). Every
  `pgEnum` is in `enums.ts` and every `relations()` call in `relations.ts`;
  violating either produces a duplicate `CREATE TYPE` or a circular import.
- `packages/db/drizzle/` — generated. Never hand-edited.
