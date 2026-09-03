import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The emitted chunk graph must be acyclic.
 *
 * Manual chunking can put two modules that depend on each other into two
 * chunks that then import each other. ES modules resolve a cycle by leaving
 * one binding undefined, so the app dies on load — and only in a BUILD, since
 * dev serves unbundled modules. Staging shipped a console that rendered a
 * blank page and threw "Cannot read properties of undefined (reading
 * 'createContext')", because pnpm's peer-suffixed directory names made a
 * substring match sweep half the TanStack packages into the React chunk.
 *
 * Nothing else catches this: typecheck passes, every unit test passes, the
 * build succeeds, and the page is blank.
 */

const ASSETS = join(import.meta.dirname, "..", "dist", "assets");

/**
 * STATIC imports only.
 *
 * A dynamic `import("./route.js")` is evaluated on demand, long after both
 * chunks exist, so a route chunk importing shared code that the entry also
 * lazily imports is normal and harmless. Only static edges are evaluated in
 * dependency order at load, and only they can leave a binding undefined.
 */
function chunks(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const file of readdirSync(ASSETS).filter((f) => f.endsWith(".js"))) {
    const source = readFileSync(join(ASSETS, file), "utf8");
    const imports = [...source.matchAll(/(?:\bfrom|^import|[;}]import)\s*"\.\/([^"]+\.js)"/gm)].map(
      (m) => m[1] as string,
    );
    graph.set(file, [...new Set(imports)]);
  }
  return graph;
}

/** Every cycle reachable from any chunk, as a readable path. */
function cycles(graph: Map<string, string[]>): string[] {
  const found: string[] = [];
  const state = new Map<string, "visiting" | "done">();

  const walk = (node: string, path: string[]) => {
    if (state.get(node) === "done") return;
    if (state.get(node) === "visiting") {
      found.push([...path.slice(path.indexOf(node)), node].join(" → "));
      return;
    }
    state.set(node, "visiting");
    for (const next of graph.get(node) ?? []) walk(next, [...path, node]);
    state.set(node, "done");
  };

  for (const node of graph.keys()) walk(node, []);
  return [...new Set(found)];
}

describe("console bundle", () => {
  it("emits chunks to check", () => {
    // Guards against the suite silently passing because the build moved.
    expect(chunks().size).toBeGreaterThan(3);
  });

  it("has no circular STATIC chunk imports", () => {
    const found = cycles(chunks());
    expect(
      found,
      "Circular chunks leave a binding undefined at load and the app renders " +
        "nothing. Group manualChunks by package name, not by substring of the " +
        "module path:\n" +
        found.join("\n"),
    ).toEqual([]);
  });

  it("keeps React in its own chunk, importing nothing else", () => {
    // React is the root of the graph. If it imports another chunk, something
    // that is not React was grouped into it.
    const graph = chunks();
    const react = [...graph.keys()].find((f) => f.startsWith("react-"));
    expect(react, "no react chunk was emitted").toBeDefined();
    expect(graph.get(react as string)).toEqual([]);
  });
});

/**
 * The console links at the public site (the QR target it prints) and calls the
 * API. Both move per environment, so neither may be written into a component.
 */
describe("console origins", () => {
  const SRC = join(import.meta.dirname);

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
    });
  }

  it("are written in exactly one module", () => {
    const allowed = join(SRC, "lib", "origins.ts");
    const offenders = sourceFiles(SRC)
      .filter((file) => file !== allowed)
      .flatMap((file) =>
        [
          ...readFileSync(file, "utf8").matchAll(
            /["'`](https?:\/\/(?:localhost|127\.0\.0\.1|[a-z-]*\.?roastery\.run)[^"'`]*)/g,
          ),
        ].map((m) => `${file.replace(SRC, "src")}: ${m[1]}`),
      );
    expect(
      offenders,
      "Import ORIGINS from @/lib/origins instead:\n" + offenders.join("\n"),
    ).toEqual([]);
  });
});
