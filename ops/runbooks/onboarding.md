# Onboarding the first organization

Between a migrated production database and a customer who can sign in, there is
exactly one manual step. Every RPC operation is scoped to an organization, so
the first one cannot be created through the API that requires it to exist.

## Create the organization

```bash
DATABASE_URL='<production Neon connection string>' \
  node apps/api/scripts/bootstrap-org.mjs \
    --name "Acme Coffee" \
    --slug acme-coffee \
    --email owner@acmecoffee.example \
    --plan advanced
```

It prints, once:

```json
{ "orgId": "…", "orgSlug": "acme-coffee", "email": "…", "plan": "advanced", "key": "sk_…" }
```

The API key is hashed in the database and cannot be read back. Put it in the
password manager before closing the terminal, or issue a new one from the
console and revoke this.

`--plan` must be a plan that exists; the script lists them if it is wrong.

## What it creates

An organization, an owner user with that email, the membership joining them, and
an owner-scoped API key. Nothing else — no locations, no products. The customer
builds those, or they are imported.

## Then

1. The owner signs in at `https://app.roastery.run` with a magic link to the
   email above. There is no password to set: sign-in is passwordless.
2. They invite their own people from Settings, and choose each person's role.
3. If they need machine access — a roast bridge, a café bridge, an integration —
   those credentials are issued from the console, not here.

## Verifying it worked

```bash
curl -s https://api.roastery.run/rpc/v1/catalog.location.listLocations \
  -X POST -H 'content-type: application/json' \
  -H "Authorization: Bearer $KEY" \
  -H "X-Roastery-Org: $ORG_ID" \
  -d '{}'
```

`{"items":[],"page":{…}}` means the whole chain works: the key verifies, the
membership resolves, the permission is granted, and the database is reachable
through Hyperdrive.

A 401 means the key did not verify. `apps/api/test/bootstrap.test.ts` runs this
script against a real database and authenticates with what it printed, so that
should have been caught before a deploy.

## Removing a test organization

Deleting the organization row cascades to everything scoped to it:

```sql
DELETE FROM organizations WHERE slug = 'acme-coffee';
```

Do this only for a mistake made minutes ago. For a real customer leaving, use
the deletion flow in the console, which also removes their reports, roast curves
and Durable Object state.

## Reference

- Deploying: `ops/runbooks/deploy.md`
- Restoring the database: `ops/runbooks/restore.md`
