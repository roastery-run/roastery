# Rolling back

## The API

Traffic is served by a **version**, so a rollback is a traffic shift and takes
effect in seconds without a build:

```bash
cd apps/api
pnpm exec wrangler deployments list --config wrangler.production.jsonc
pnpm exec wrangler versions deploy <previous-version-id>@100 \
  --config wrangler.production.jsonc --yes
```

The deploy log prints the rollback target before it shifts any traffic.

## What a rollback does NOT undo

The database. Deploys migrate first, so a rollback returns the code and leaves
the schema ahead of it. That is survivable because migrations are expand-only:
the previous release ignores a column it does not know about. It is *not*
survivable for a migration marked `-- contract: approved`, which is why those
are deployed on their own with `rollout: 100` and no split.

If a contract migration has to be undone, restore the database
(`ops/runbooks/restore.md`) rather than reverting the Worker.

## web, console, docs

These are full deploys rather than versions. Roll back by re-running the deploy
workflow from the previous commit.

## Reference

- Deploy: `ops/runbooks/deploy.md`
- Restore the database: `ops/runbooks/restore.md`
