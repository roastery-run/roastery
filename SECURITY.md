# Security

## Reporting a vulnerability

Email **security@roastery.run** with enough detail to reproduce: the request,
the response, and what you were able to reach that you should not have been.
Please do not open a public issue, and please do not test against another
organization's data — a staging organization can be issued for you on request.

We will acknowledge within two business days and tell you what we found and
when the fix ships. If the issue is exploitable against production, expect
contact sooner than that.

Out of scope: reports from an automated scanner with no demonstrated impact,
missing headers on endpoints that carry no session, rate limits reached by
deliberately exceeding a documented budget, and social engineering.

## What we protect, and how

Useful context for a report, and for anyone reviewing a change that touches
these paths.

**Tenant isolation is application-layer.** There is no Postgres RLS. Handlers
reach tenant data only through `OrgDb`, whose org predicate is `and()`-ed in
where a caller cannot overwrite it; the raw handle is deliberately named
`unsafeDb`. Every table is classified once in `packages/db/src/tenancy.ts` and
`apps/api/test/authorization.test.ts` fails the build on any table or operation
that is not. **A cross-tenant read is the highest-severity report we can
receive** — say so in the subject line.

**Authorization runs before validation**, in a fixed order: 401 authentication,
403 org access, 402 entitlement, 403 permission, then the body schema. An
unauthenticated caller sending a malformed body gets a 401, never a 400
describing the request shape.

**Permissions are data**, granted explicitly in migrations, never silently
added to an existing role.

**Credentials.** Sign-in is passwordless — magic link or OAuth. API keys are
stored hashed and cannot be read back after issue. An `Actor` carries both the
credential id and the id of the person behind it, so a key a human created acts
for that human and is attributable to them.

**Caches never outlive a revocation.** Authorization reads and all writes go
through the cache-disabled Hyperdrive config; responses default to
`no-store` and caching is opt-in per handler.

**Rate limits are configuration, not call-site numbers**, and each surface has
its own namespace: sending a sign-in link is five per minute per IP, separately
from the general auth budget, because that endpoint puts mail in an address of
the caller's choosing under our sending reputation.

**Outbound webhooks** are signed, delivered with a documented retry schedule,
and guarded against SSRF (`apps/api/src/lib/events/ssrf.ts`) — a customer
supplies the destination URL, so a delivery attempt must not become a request
to internal infrastructure.

**Unauthenticated by design**, each carrying its own protection: `/trace/v1`
takes an unguessable token from a QR code on a retail bag, and `/reports/v1`
takes an expiring signature. A trace token that leaks more than the certificate
it is meant to show is a valid report.

**Secrets** are Worker secrets set by `scripts/setup-secrets.sh`; nothing
sensitive lives in a `wrangler.*.jsonc`, and any value containing `localhost`
is refused for production. `.env`, `.dev.vars` and `*.vars` are gitignored. If
you believe a secret has been committed, report it the same way and do not push
a fix that only removes it from the tip.

## Supported versions

ROASTERY is a hosted service. The deployed version is the supported one; there
are no maintained release branches.
