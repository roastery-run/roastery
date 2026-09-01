/**
 * Regenerates packages/db/src/schema/oauth.ts from the plugin's own schema.
 *
 * Run after upgrading @better-auth/oauth-provider. Transcribing seven models
 * by hand is how a field the adapter expects goes missing, and that failure
 * shows up at runtime rather than at build.
 *
 *   node --input-type=module packages/auth/scripts/generate-oauth-schema.mjs
 */

import fs from "node:fs";
import { oauthProvider } from "@better-auth/oauth-provider";

const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const TABLE = {
  oauthClient: "oauth_clients",
  oauthResource: "oauth_resources",
  oauthClientResource: "oauth_client_resources",
  oauthRefreshToken: "oauth_refresh_tokens",
  oauthAccessToken: "oauth_access_tokens",
  oauthConsent: "oauth_consents",
  oauthClientAssertion: "oauth_client_assertions",
};
const VAR = {
  oauthClient: "oauthClients",
  oauthResource: "oauthResources",
  oauthClientResource: "oauthClientResources",
  oauthRefreshToken: "oauthRefreshTokens",
  oauthAccessToken: "oauthAccessTokens",
  oauthConsent: "oauthConsents",
  oauthClientAssertion: "oauthClientAssertions",
};
const REFVAR = {
  user: "users",
  session: "sessions",
  oauthClient: "oauthClients",
  oauthResource: "oauthResources",
  oauthRefreshToken: "oauthRefreshTokens",
};

// Postgres: the adapter reports supportsJSON and supportsArrays, so json maps
// to jsonb and string[] to a native text[] column.
function col(field, def) {
  const c = JSON.stringify(snake(field));
  switch (def.type) {
    case "string[]":
      return `text(${c}).array()`;
    case "json":
      return `jsonb(${c})`;
    case "boolean":
      return `boolean(${c})`;
    case "number":
      return `integer(${c})`;
    case "date":
      return `timestamp(${c}, { withTimezone: true })`;
    default:
      return `text(${c})`;
  }
}

const schema = oauthProvider({}).schema ?? {};
const tables = [];

for (const [model, def] of Object.entries(schema)) {
  const lines = [
    `export const ${VAR[model]} = pgTable(`,
    `  ${JSON.stringify(TABLE[model])},`,
    "  {",
  ];
  lines.push('    id: text("id").primaryKey(),');
  const indexes = [];
  for (const [field, d] of Object.entries(def.fields ?? {})) {
    let line = `    ${field}: ${col(field, d)}`;
    if (d.required) line += ".notNull()";
    // An inline UNIQUE constraint, not a separate unique index: a foreign key
    // may only target a constraint that already exists when it is created, and
    // drizzle emits CREATE UNIQUE INDEX after the ALTER TABLE ... ADD FOREIGN
    // KEY that needs it. oauth_clients.client_id and oauth_resources.identifier
    // are both FK targets.
    if (d.unique) line += ".unique()";
    if (d.defaultValue !== undefined && typeof d.defaultValue !== "function") {
      line += `.default(${JSON.stringify(d.defaultValue)})`;
    }
    if (d.references && REFVAR[d.references.model]) {
      line += `.references(() => ${REFVAR[d.references.model]}.${d.references.field}, { onDelete: "cascade" })`;
    }
    lines.push(`${line},`);
    const idxName = JSON.stringify(`${TABLE[model]}_${snake(field)}_idx`);
    if (!d.unique && d.references) indexes.push(`    index(${idxName}).on(t.${field}),`);
  }
  // Omit the index callback entirely when a table has no indexes; an empty
  // `(t) => []` leaves an unused parameter that the linter flags.
  if (indexes.length) lines.push("  },", "  (t) => [", ...indexes, "  ],", ");");
  else lines.push("  },", ");");
  tables.push(lines.join("\n"));
}

const header = fs
  .readFileSync(new URL("../../db/src/schema/oauth.ts", import.meta.url), "utf8")
  .split("\nexport const ")[0];

fs.writeFileSync(
  new URL("../../db/src/schema/oauth.ts", import.meta.url),
  `${header}\n${tables.join("\n\n")}\n`,
);
console.log(`regenerated ${Object.keys(schema).length} oauth tables`);
