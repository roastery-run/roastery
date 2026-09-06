import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { RPC_REGISTRY, rpcPath } from "../src/lib/api/rpc";
import { testEnv } from "./helpers/app";

/**
 * The published API reference is generated, so it needs a test asserting it
 * matches its source — the same rule `partitioning.test.ts` and
 * `pricing.test.ts` already follow.
 *
 * The docs build fetches the live spec and falls back to a checked-in snapshot
 * when the API is not running. That fallback is what makes a docs deploy
 * independent of a server, and it is also the way the reference can go stale
 * without anybody noticing — the build succeeds either way, and nothing
 * compared the two. An integrator reading a reference that omits an endpoint
 * concludes it does not exist.
 *
 * The snapshot happened to be current when this was written. That is the
 * point: it stays current only while something checks.
 */
const SNAPSHOT = join(import.meta.dirname, "..", "..", "docs", "openapi.snapshot.json");

async function publicSpec(): Promise<{ paths: Record<string, unknown> }> {
  const response = await app.fetch(new Request("http://localhost/openapi.public.json"), testEnv());
  expect(response.status).toBe(200);
  return (await response.json()) as { paths: Record<string, unknown> };
}

describe("the published OpenAPI snapshot", () => {
  it("lists exactly the operations the API publishes", async () => {
    const live = Object.keys((await publicSpec()).paths).sort();
    const snapshot = Object.keys(
      (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { paths: Record<string, unknown> }).paths,
    ).sort();

    const missing = live.filter((p) => !snapshot.includes(p));
    const extra = snapshot.filter((p) => !live.includes(p));

    expect(
      { missing, extra },
      "The checked-in reference no longer matches the API. Regenerate it:\n" +
        "  pnpm --filter @roastery/api dev   # in another terminal\n" +
        "  pnpm --filter @roastery/docs reference",
    ).toEqual({ missing: [], extra: [] });
  });

  /**
   * Path names were the whole check, and that is not enough.
   *
   * Adding `q` to two list filters changed what those endpoints accept and
   * added no path, so the reference went stale and this test stayed green.
   * Five paths had drifted by the time anybody looked. An integrator reading
   * a reference that omits a filter concludes it does not exist, which is the
   * same failure as omitting an endpoint, arriving more quietly.
   *
   * Safe to compare byte-for-byte: the emitted document is deterministic —
   * two runs of the generator produce identical output.
   */
  it("describes each operation exactly as the API does", async () => {
    const live = (await publicSpec()).paths;
    const snapshot = (
      JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { paths: Record<string, unknown> }
    ).paths;

    const drifted = Object.keys(live)
      .filter((path) => path in snapshot)
      .filter((path) => JSON.stringify(live[path]) !== JSON.stringify(snapshot[path]));

    expect(
      drifted,
      "These operations changed shape without the reference being regenerated:\n" +
        "  pnpm --filter @roastery/api dev   # in another terminal\n" +
        "  pnpm --filter @roastery/docs reference",
    ).toEqual([]);
  });

  it("excludes every internal operation", async () => {
    // `console.*` operations are in the full document so the console's client
    // is typed and the authorization test can enumerate them. Publishing them
    // would invite integrations against operations we change freely.
    const live = Object.keys((await publicSpec()).paths);
    const internal = RPC_REGISTRY.filter((d) => d.internal).map((d) => rpcPath(d));

    expect(internal.length).toBeGreaterThan(0);
    expect(live.filter((path) => internal.includes(path))).toEqual([]);
  });
});
