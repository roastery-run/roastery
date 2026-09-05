/**
 * Turns the API's own OpenAPI document into reference pages.
 *
 * Generated rather than written, because hand-written reference documentation
 * describes the API as it was on the day somebody last remembered — and the
 * failure is silent. An integrator follows a page that is a release behind and
 * gets a 400 they cannot explain.
 *
 * Reads the PUBLIC document (`/openapi.public.json`), which excludes the
 * `console.*` operations. Those are in the spec so the console's client is
 * typed and the authorization test can enumerate them, but they are not part of
 * anyone's integration contract and publishing them would invite people to
 * build on operations we change freely.
 *
 *   node apps/docs/scripts/generate-reference.mjs
 *
 * Falls back to a checked-in snapshot when the API is not running, so a docs
 * build never depends on a live server.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const API_URL = process.env.API_URL ?? "http://localhost:8787";

/**
 * Whether this build was pointed at a real deployment.
 *
 * The distinction that decides whether an unreachable API is a fallback or a
 * failure. Absent or localhost means "build from the snapshot", which is what
 * an ordinary CI run and a local build both want.
 */
const isDeployedApi =
  Boolean(process.env.API_URL) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(API_URL);

// The base shown in copyable curl examples. Not API_URL: the docs are built
// against whichever API is reachable, but a reader copying a command wants the
// public endpoint for the environment being documented.
const API_PUBLIC_URL = process.env.API_PUBLIC_URL ?? "https://api.roastery.run";
const OUT = join(import.meta.dirname, "..", "src", "content", "docs", "reference");
const SNAPSHOT = join(import.meta.dirname, "..", "openapi.snapshot.json");

async function loadSpec() {
  try {
    const response = await fetch(`${API_URL}/openapi.public.json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(String(response.status));
    const spec = await response.json();
    // Snapshotted on every successful fetch, so a build without the API
    // running still produces the reference that the last one did.
    writeFileSync(SNAPSHOT, JSON.stringify(spec, null, 2));
    console.log(`fetched the public spec from ${API_URL}`);
    return spec;
  } catch (error) {
    if (!existsSync(SNAPSHOT)) {
      throw new Error(
        `Could not reach ${API_URL} and no snapshot exists at ${SNAPSHOT}. ` +
          "Start the API worker once so a snapshot can be written.",
      );
    }
    // The fallback keeps a docs build independent of a running server, and it
    // is also how a stale reference ships without anyone noticing. Which of
    // those matters depends on why the build is running.
    //
    // Keyed on whether the caller pointed at a DEPLOYED api, not on `CI`.
    // Gating on CI was wrong and broke every ordinary build: the lint and test
    // pipeline has no API running and is not expected to, so it correctly
    // wants the snapshot. A deploy is different — `deploy-staging.sh` and
    // `deploy-production.sh` both set API_URL to the API they just deployed,
    // so an unreachable one there means the pipeline is about to republish a
    // reference nobody verified.
    if (isDeployedApi) {
      throw new Error(
        `Could not reach ${API_URL}: ${error instanceof Error ? error.message : error}.\n` +
          "API_URL names a deployed API, so refusing to fall back to the checked-in " +
          "snapshot — that would publish a reference nobody verified against a running " +
          "server. Unset API_URL to build the docs from the snapshot deliberately.",
      );
    }
    console.log("API unreachable; using the checked-in snapshot");
    return JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  }
}

const escapeMdx = (value) => String(value).replace(/[{}<>]/g, (c) => `\\${c}`);

/**
 * A YAML scalar that survives a colon.
 *
 * Frontmatter is YAML, and a description containing ": " parses as a mapping —
 * which fails the build with an error pointing at the file rather than at the
 * sentence that caused it.
 */
const yamlScalar = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Resolves a `$ref` against the document, one level — enough for our schemas. */
function resolve(spec, node, depth = 0) {
  if (!node || depth > 8) return node;
  if (node.$ref) {
    const path = node.$ref.replace(/^#\//, "").split("/");
    let target = spec;
    for (const segment of path) target = target?.[segment];
    return resolve(spec, target, depth + 1);
  }
  return node;
}

/** A compact, readable type for one schema node. */
function describeType(spec, schema, depth = 0) {
  const node = resolve(spec, schema, depth);
  if (!node || depth > 4) return "object";
  if (node.enum) return node.enum.map((v) => `\`${v}\``).join(" \\| ");
  if (node.anyOf || node.oneOf) {
    return (node.anyOf ?? node.oneOf).map((s) => describeType(spec, s, depth + 1)).join(" \\| ");
  }
  if (node.type === "array") return `${describeType(spec, node.items, depth + 1)}[]`;
  if (node.type === "object" || node.properties) return "object";
  return node.type ?? "unknown";
}

/** The request body's top-level fields, which is what a reader needs first. */
function fieldTable(spec, schema) {
  const node = resolve(spec, schema);
  const properties = node?.properties;
  if (!properties || Object.keys(properties).length === 0) return "";

  const required = new Set(node.required ?? []);
  const rows = Object.entries(properties).map(([name, value]) => {
    const field = resolve(spec, value);
    const description = (field?.description ?? "").replace(/\s*\n\s*/g, " ").trim();
    return `| \`${name}\` | ${describeType(spec, value)} | ${required.has(name) ? "yes" : "no"} | ${escapeMdx(description)} |`;
  });

  return ["| Field | Type | Required | Description |", "| --- | --- | --- | --- |", ...rows].join(
    "\n",
  );
}

const spec = await loadSpec();

// Grouped by namespace, which is how the API is organized and how somebody
// integrating actually thinks — "everything I need for inventory".
const byNamespace = new Map();
for (const [path, item] of Object.entries(spec.paths ?? {})) {
  const match = /^\/rpc\/v1\/([a-z.]+)\.([a-zA-Z]+)$/.exec(path);
  if (!match) continue;
  const [, namespace, operation] = match;
  const post = item.post;
  if (!post) continue;

  const list = byNamespace.get(namespace) ?? [];
  list.push({ path, operation, post, cacheable: Boolean(item.get) });
  byNamespace.set(namespace, list);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let operationCount = 0;

/**
 * The label and the order both come from the spec's own tags, which the API
 * declares in one place. Deriving them here instead — "Inventory · Green" from
 * splitting the slug — meant the docs site and the API reference disagreed
 * about what a section is called, and neither was the name anyone uses.
 */
const tagsByName = new Map((spec.tags ?? []).map((tag) => [tag.name, tag]));
const order = (spec.tags ?? []).map((tag) => tag.name);
const namespaces = [...byNamespace.keys()].sort((a, b) => {
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  // An untagged namespace is a bug the API's own test catches; sort it last
  // rather than first, so it does not displace the opening of the story.
  if (ia === -1 || ib === -1) return (ia === -1) - (ib === -1) || a.localeCompare(b);
  return ia - ib;
});

for (const namespace of namespaces) {
  const operations = byNamespace.get(namespace);
  operations.sort((a, b) => a.operation.localeCompare(b.operation));
  operationCount += operations.length;

  const sections = operations.map(({ path, operation, post, cacheable }) => {
    const body = post.requestBody?.content?.["application/json"]?.schema;
    const fields = body ? fieldTable(spec, body) : "";
    const description = (post.description ?? "").trim();

    return `## ${namespace}.${operation}

${post.summary ?? ""}

\`\`\`http
POST ${path}
\`\`\`
${cacheable ? "\nAlso available as `GET` with a URL-encoded `input` query parameter, so the response can be HTTP-cached.\n" : ""}
${description ? `${escapeMdx(description)}\n` : ""}
${fields ? `### Request\n\n${fields}\n` : ""}
### Example

\`\`\`bash
curl -X POST ${escapeMdx(`${API_PUBLIC_URL}${path}`)} \\
  -H "Authorization: Bearer $ROASTERY_API_KEY" \\
  -H "X-Roastery-Org: $ORG_ID" \\
  -H "Content-Type: application/json" \\
  -d '{}'
\`\`\``;
  });

  const tag = tagsByName.get(namespace);
  const title =
    tag?.["x-displayName"] ??
    namespace
      .split(".")
      .map((part) => part.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()))
      .join(" · ");
  const description = tag?.description ?? `The ${namespace} operations of the ROASTERY API.`;

  const page = `---
title: ${title}
description: ${yamlScalar(description)}
sidebar:
  order: ${namespaces.indexOf(namespace) + 1}
---

{/* GENERATED by apps/docs/scripts/generate-reference.mjs. Do not hand-edit. */}

${escapeMdx(description)}

${operations.length} operation${operations.length === 1 ? "" : "s"} in the \`${namespace}\` namespace.

${sections.join("\n\n---\n\n")}
`;

  const file = join(OUT, `${namespace.replace(/\./g, "-")}.mdx`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, page);
}

console.log(
  `wrote ${byNamespace.size} reference pages covering ${operationCount} public operations`,
);
