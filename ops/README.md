# Operations

Runbooks for the things you do to a running system. Each one is written to be
followed under time pressure, so they say what to run and what it does rather
than explaining the design — that is [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

| Runbook | When |
| --- | --- |
| [`runbooks/deploy.md`](runbooks/deploy.md) | Shipping to staging or production, and what the pipeline does in what order |
| [`runbooks/rollback.md`](runbooks/rollback.md) | A bad release is serving traffic |
| [`runbooks/restore.md`](runbooks/restore.md) | The database needs to go back in time |
| [`runbooks/onboarding.md`](runbooks/onboarding.md) | A new customer needs their first organization |

Two things worth knowing before you need any of them:

- **A rollback does not undo the database.** Deploys migrate before traffic
  shifts, which is safe because migrations are expand-only — the previous
  release ignores a column it does not know about. A migration marked
  `-- contract: approved` is the exception, ships on its own at `rollout: 100`,
  and can only be undone by restoring.
- **The deploy job skips, and reports success, until its environment has both
  `CLOUDFLARE_API_TOKEN` and `DATABASE_URL`.** Everything before the deploy
  still runs, so a merge is still verified. That is deliberate: a workflow that
  is red for a reason nobody intends to fix today is one people stop reading.

Scripts these runbooks call live in [`../scripts`](../scripts).
