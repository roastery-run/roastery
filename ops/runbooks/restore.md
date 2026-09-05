# Restoring the database

The ledger is the product's auditable core, so its recovery story is part of
the product. This is the procedure and the settings it depends on.

## Settings this depends on (must be applied in the Neon console)

The project is `falling-mountain-98671774`, branch `production`
(`br-ancient-shape-axlabby8`). As of the production-readiness audit these were
all still at their defaults, which is not enough to recover from anything:

| Setting | Was | Should be | Why |
|---|---|---|---|
| Branch protection | off | **on** | Nothing stops a `delete_branch` against production today. |
| Snapshot schedule | none | **daily, keep 7** | There are no backups at all. PITR alone cannot survive a bad migration noticed the next morning. |
| History retention (PITR) | 6 hours | **7 days** | Six hours does not cover "someone noticed on Monday". |
| Compute | fixed 0.25 CU | **0.25 – 2 CU** | No headroom. A reconciliation run plus normal traffic has nowhere to go. |

These cost money and change a live account, so they are listed here rather than
applied by a script.

## Point-in-time restore

Neon restores by branching, which is what makes this safe to attempt: the
original branch is untouched until you deliberately swap.

1. **Stop writes.** Deploy the API with the previous version, or accept that
   writes after the restore point are lost — decide explicitly, and write down
   which.
2. **Branch from the moment before the damage:**
   ```
   neon branches create --project-id falling-mountain-98671774 \
     --name recover-YYYYMMDD --parent production --timestamp 2026-09-05T09:12:00Z
   ```
3. **Check it before touching production.** Connect to the new branch and
   verify the specific damage is absent — the row count, the lot, the
   migration that should not be there.
4. **Point Hyperdrive at the recovered branch.** Both configs: `HYPERDRIVE` and
   `HYPERDRIVE_CACHE_DISABLED`. This is the cutover, and it is a config change
   rather than a data move, so it is quick and reversible.
5. **Reconcile.** Run the maintenance job for every org and read
   `inventory_reconciliations`. A restore rolls the ledger and the cached
   balances back together, so drift here means the restore point was wrong.
6. **Replay what the outbox lost.** Events committed after the restore point are
   gone; deliveries already sent cannot be unsent. Tell affected integrators
   rather than hoping the difference is invisible.

## What a Worker rollback does not fix

Deploys migrate before traffic shifts. Rolling back the Worker leaves the schema
ahead of the code, which is survivable only because migrations are expand-only
(`scripts/check-migration-expand-only.mjs`). A migration marked
`-- contract: approved` is the exception, and undoing one means restoring here.

## Reference

- Deploying: `ops/runbooks/deploy.md`
- Rolling back a release: `ops/runbooks/rollback.md`
