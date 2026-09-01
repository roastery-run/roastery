// Extensions drizzle-kit cannot express. pg_trgm backs the trigram indexes on
// partner / producer / lot / customer names used by every entity search box.
import { config } from "dotenv";
import pg from "pg";

config({ path: "../../.env", quiet: true });
config({ path: "../../../.env", quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
await client.end();
console.log("extensions ok (pg_trgm)");
