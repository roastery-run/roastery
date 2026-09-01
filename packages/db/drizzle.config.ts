import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: "../../.env", quiet: true });

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // biome-ignore lint/style/noNonNullAssertion: drizzle-kit is a CLI; failing loudly here is correct.
  dbCredentials: { url: process.env.DATABASE_URL! },
});
