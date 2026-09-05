# Deploying

## Before either environment works

The deploy job SKIPS, and reports success, until the environment has both
`CLOUDFLARE_API_TOKEN` and `DATABASE_URL` configured. Everything before the
deploy still runs — lint, typecheck, the full test suite against a real
Postgres, and the config placeholder check — so a merge is still verified; only
the shipping is skipped. It starts deploying by itself once the secrets exist.

That is deliberate. A workflow that is red for a reason nobody intends to fix
today is one people stop reading, and a real failure then goes unread with it.

## Before the first automatic staging deploy

Staging deploys on every push to `main`, so the first merge after the secrets
exist will ship on its own. Two queues added by the production-readiness work
have never been created, and wrangler does not create them for you — the deploy
fails on a missing queue rather than provisioning one:

```bash
wrangler queues create roastery-maintenance-staging
wrangler queues create roastery-maintenance-dlq-staging
```

Everything else staging needs already exists from earlier deploys: the KV
namespace, the R2 bucket, both Hyperdrive configs and the other eight queues.
Rate-limit namespaces are configuration rather than resources, and the
Analytics Engine dataset is created on first write.

Two secrets turn the deploy on, and until both exist the job skips with a
notice rather than failing: `CLOUDFLARE_API_TOKEN` (Workers, KV, Queues, R2 and
Hyperdrive scopes) and `DATABASE_URL` for the Neon `staging` branch. Worker
secrets are separate, and go on with
`scripts/setup-secrets.sh staging`.

`logpush: true` opts the Worker in; the destination is a Logpush job configured
in the dashboard. Its absence does not fail a deploy.

## Staging

Automatic on every push to `main` (`.github/workflows/deploy.yml`). To deploy by
hand: `pnpm deploy:staging`, with `DATABASE_URL` pointing at the Neon `staging`
branch. The migration wrapper checks that for you and refuses if it points
elsewhere.

## Production

Actions → Deploy → Run workflow → environment `production`. It requires an
approval on the `production` GitHub environment.

What it does, in order:

1. `pnpm check`, `pnpm typecheck`, `pnpm test`.
2. Refuses if any production wrangler config still holds a `TODO_ID_*`
   placeholder.
3. Migrates the production Neon branch, under an advisory lock, after checking
   the host is the production endpoint.
4. Uploads a new API **version** and prints the current one as the rollback
   target.
5. Sends 10% of traffic to it, polls `/health` every 30s for 5 minutes, and
   rolls back automatically if it stops returning 200.
6. Goes to 100%, then deploys web, console and docs.

### When a release adds a Durable Object migration

Set `rollout` to `100`. A split rollout runs two versions at once, and they
cannot disagree about a Durable Object class.

### Migrations and ordering

The database is migrated **before** traffic shifts, so the release still serving
during the rollout is the previous one, running against the new schema. That is
only safe for expand-only changes, which CI enforces
(`scripts/check-migration-expand-only.mjs`). To remove a column: ship the code
that stops using it in one release, remove the column in the next.

A contract migration must be marked in the SQL and cannot be split:

```sql
-- contract: approved — dropped in v42, unused since v41
```

### Secrets

`scripts/setup-secrets.sh production`, reading `apps/api/.production.vars`
(gitignored). A `_PRODUCTION`-suffixed name wins over the bare one, and any
value containing `localhost` is refused.

Required: `BETTER_AUTH_SECRET`, `WEBHOOK_KEK` (32 base64 bytes), `EMAIL_FROM`.
Optional: `EMAIL_API_URL` + `EMAIL_API_KEY`, the GitHub/Google OAuth pairs, the
`SSO_*` set.
