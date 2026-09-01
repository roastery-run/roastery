import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

export * from "./schema/index";
export * from "./seed-authz";

/**
 * Node client, for migrations, seeds and scripts. The Worker runtime uses a
 * different driver (postgres.js over Hyperdrive) — see apps/api/src/lib/db.ts.
 */
export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return drizzle(pool, { schema });
}

export type Database = ReturnType<typeof createDb>;
