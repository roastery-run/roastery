import { defineConfig } from "vitest/config";

const alias = {
  // The app re-exports its Durable Object, which extends a base class only
  // the Workers runtime provides. The tests that import the app do so to
  // read its route registry, never to run a DO, so a structural stub keeps
  // them in a plain Node environment — which is what makes them fast
  // enough to run on every save.
  "cloudflare:workers": new URL("./test/stubs/cloudflare-workers.ts", import.meta.url).pathname,
};

/**
 * Two projects, split exactly where CLAUDE.md already splits them: unit tests
 * next to their code, database tests in `test/`.
 *
 * The split is a runner concern because the database ones contend with each
 * other. They deliberately provoke lock contention — ten writers on one lot,
 * competing allocations, attaching a partition to a table another suite is
 * inserting into — and run in parallel they fight over the same rows and the
 * same table locks. That produced a genuinely intermittent failure: a
 * concurrency test that passes in 800ms alone timing out at five seconds
 * beside its neighbours. Slow is not the problem; a suite people re-run until
 * it goes green is.
 *
 * So the database project runs one file at a time, after the unit project has
 * finished, with a timeout that suits it. The unit project — the large
 * majority, and the one that runs on every save — keeps its parallelism.
 *
 * `groupOrder` is what separates them in time. Left to run alongside, sixteen
 * unit workers saturate the machine and a ten-writer ledger test that takes
 * 800ms alone takes longer than the five-second default, which looks exactly
 * like a deadlock and is only a busy laptop. CI is slower than a laptop, so
 * the timeout is generous rather than tuned.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          sequence: { groupOrder: 0 },
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["test/**/*.test.ts"],
          // One file at a time, and only once the unit project is done.
          fileParallelism: false,
          sequence: { groupOrder: 1 },
          // A concurrency test provokes lock contention on purpose; five
          // seconds is a unit test's budget, not one that waits on Postgres.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
