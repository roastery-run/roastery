/**
 * Creates the first organization in an empty database, with an owner and an
 * API key.
 *
 * The only script here that writes Postgres directly, and deliberately so:
 * every RPC operation requires an organization to be scoped to, so the first
 * tenant cannot be created through the API that needs it to exist. Everything
 * after this — see seed-demo.mjs — goes through the API.
 *
 *   DATABASE_URL=… node apps/api/scripts/bootstrap-org.mjs \
 *     --name "Acme Coffee" --email owner@example.com --plan advanced
 *
 * Prints the API key ONCE. It is hashed in the database and cannot be read
 * back, which is the point.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(`--${flag}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const NAME = arg("name", "Acme Coffee");
const EMAIL = arg("email", "owner@acme.test");
const PLAN = arg("plan", "advanced");
const SLUG = arg(
  "slug",
  NAME.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, ""),
);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

/**
 * Matches @better-auth/api-key's `defaultKeyHasher`: SHA-256, base64url, no
 * padding. Reproduced rather than imported because the plugin's hasher is not
 * exported — and a mismatch here fails as "invalid credential" at request
 * time, which is a slow way to learn about it.
 */
const hashKey = (raw) => createHash("sha256").update(raw).digest("base64url");

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query("BEGIN");

  const plan = await client.query("select slug from plans where slug = $1", [PLAN]);
  if (!plan.rowCount) {
    const all = await client.query("select slug from plans order by rank");
    throw new Error(`No plan "${PLAN}". Available: ${all.rows.map((r) => r.slug).join(", ")}`);
  }

  const org = await client.query(
    `insert into organizations (name, slug) values ($1, $2)
     on conflict (slug) do update set name = excluded.name
     returning id, name, slug`,
    [NAME, SLUG],
  );
  const orgId = org.rows[0].id;

  const userId = randomUUID();
  const user = await client.query(
    `insert into users (id, name, email, email_verified) values ($1, $2, $3, true)
     on conflict (email) do update set name = excluded.name
     returning id`,
    [userId, EMAIL.split("@")[0], EMAIL],
  );

  await client.query(
    `insert into org_members (org_id, user_id, role_slug) values ($1, $2, 'owner')
     on conflict do nothing`,
    [orgId, user.rows[0].id],
  );

  await client.query(
    `insert into org_subscriptions (org_id, plan_slug, status) values ($1, $2, 'active')
     on conflict (org_id) do update set plan_slug = excluded.plan_slug, status = 'active'`,
    [orgId, PLAN],
  );

  // 32 bytes of hex behind the plugin's prefix, matching issueApiKey().
  const raw = `sk_${randomBytes(32).toString("hex")}`;
  await client.query(
    `insert into api_keys
       (id, config_id, name, prefix, start, key, enabled, reference_id,
        rate_limit_enabled, rate_limit_max, rate_limit_time_window, request_count, metadata)
     values ($1, 'default', $2, 'sk_', $3, $4, true, $5, true, 10000, 60000, 0, $6)`,
    [
      randomUUID(),
      "bootstrap",
      raw.slice(0, 10),
      hashKey(raw),
      orgId,
      JSON.stringify({ roleSlug: "owner", scopes: null, createdBy: user.rows[0].id }),
    ],
  );

  await client.query("COMMIT");

  console.log(
    JSON.stringify({ orgId, orgSlug: SLUG, email: EMAIL, plan: PLAN, key: raw }, null, 2),
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
