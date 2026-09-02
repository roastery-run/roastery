/**
 * Rewrites `@/…` imports to relative paths inside this package.
 *
 * The shadcn CLI writes `@/lib/utils` and `@/ui/button`, which is correct for
 * an application. This package is consumed as SOURCE by three apps, so at
 * compile time `@/` resolves to the CONSUMING app's src — and the component
 * silently reaches for a file that does not exist there.
 *
 * Run after `shadcn add`:
 *   pnpm --filter @roastery/ui normalize
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const SRC = join(import.meta.dirname, "..", "src");

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(full)) yield full;
  }
}

let changed = 0;
for (const file of walk(SRC)) {
  const original = readFileSync(file, "utf8");
  const updated = original.replace(/(["'])@\/([^"']+)\1/g, (_match, quote, target) => {
    let specifier = relative(dirname(file), join(SRC, target)).replaceAll("\\", "/");
    if (!specifier.startsWith(".")) specifier = `./${specifier}`;
    return `${quote}${specifier}${quote}`;
  });
  if (updated !== original) {
    writeFileSync(file, updated);
    changed += 1;
  }
}

console.log(`normalized imports in ${changed} file(s)`);
