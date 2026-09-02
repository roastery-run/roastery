/**
 * Schema barrel. `drizzle.config.ts` points here and walks the exports, so it
 * is indifferent to how many files the schema is split across.
 *
 * The order of `export *` is irrelevant (ES module bindings are hoisted). What
 * must stay acyclic is the IMPORT graph between the modules themselves:
 *
 *   enums -> auth -> oauth -> org -> catalog -> inventory -> materials -> sourcing -> ...
 *
 * A module may only import from modules earlier in that chain.
 */
export * from "./auth";
export * from "./catalog";
export * from "./enums";
export * from "./inventory";
export * from "./materials";
export * from "./oauth";
export * from "./org";
export * from "./production";
export * from "./roasted";
export * from "./sourcing";
