import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE } from "./site";

/**
 * The first staging deploy shipped a marketing site whose "Sign in" button
 * pointed at http://localhost:5174.
 *
 * Nothing was broken in the usual sense — every link was already written as
 * `import.meta.env.VITE_X ?? "http://localhost:…"`, and the fallback did
 * exactly what it said. The bug was that a build with no env silently produced
 * a public site full of localhost links, and only a person clicking one would
 * ever find out.
 *
 * So the fallbacks live in ONE module, and no route may write an origin.
 */

const SRC = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Where an origin is legitimately written. */
const ALLOWED = [
  join(SRC, "content", "site.ts"),
  // Reads the Worker's runtime API_URL, which is deliberately NOT baked into
  // the client bundle: it can change without a rebuild.
  join(SRC, "routes", "trace.$code.tsx"),
];

describe("site origins", () => {
  it("are written in exactly one module", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !ALLOWED.includes(file))
      .flatMap((file) => {
        const found = [
          ...readFileSync(file, "utf8").matchAll(
            /["'`](https?:\/\/(?:localhost|127\.0\.0\.1|[a-z-]*\.?roastery\.run)[^"'`]*)/g,
          ),
        ];
        return found.map((m) => `${file.replace(SRC, "src")}: ${m[1]}`);
      });

    expect(
      offenders,
      "An origin written into a route ships whatever it says. Import SITE from " +
        "@/content/site instead, so one env file moves every link at once:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("defaults every origin to a local port when no env is set", () => {
    // vitest runs with no VITE_* env, so this asserts the dev fallbacks.
    for (const [name, url] of Object.entries(SITE)) {
      expect(url, `${name} should fall back to localhost in development`).toMatch(
        /^http:\/\/localhost:\d+$/,
      );
    }
  });

  it("points the console fallback at the port the console actually serves", () => {
    // A mismatch here sends a developer clicking "Sign in" to whatever else
    // happens to be on that port, which is a confusing way to learn about it.
    const config = readFileSync(join(SRC, "..", "..", "console", "vite.config.ts"), "utf8");
    const port = config.match(/port:\s*(\d+)/)?.[1];
    expect(port, "could not read the console's configured port").toBeDefined();
    expect(SITE.console).toBe(`http://localhost:${port}`);
  });
});

describe("environment files", () => {
  const envDir = join(SRC, "..");
  const keys = (mode: string) =>
    readFileSync(join(envDir, `.env.${mode}`), "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => line.split("=")[0]);

  it("define the same variables for every deployed environment", () => {
    // A variable present in one file and missing from another is how one
    // environment silently keeps a localhost fallback.
    expect(keys("staging").sort()).toEqual(keys("production").sort());
  });

  it("marks only production indexable", () => {
    const read = (mode: string) => readFileSync(join(envDir, `.env.${mode}`), "utf8");
    expect(read("production")).toContain("VITE_INDEXABLE=true");
    expect(read("staging")).toContain("VITE_INDEXABLE=false");
  });
});
