import type * as schema from "@roastery/db/schema";
import type { drizzle } from "drizzle-orm/postgres-js";

/**
 * The Drizzle client shape the Worker builds per request. Declared here so the
 * auth package never imports Cloudflare bindings or a driver directly.
 */
export type WorkerDb = ReturnType<typeof drizzle<typeof schema>>;
