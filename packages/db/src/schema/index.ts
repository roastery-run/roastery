/**
 * Schema barrel. `drizzle.config.ts` points here and walks the exports, so it
 * is indifferent to how many files the schema is split across.
 *
 * The order of `export *` is irrelevant (ES module bindings are hoisted). What
 * must stay acyclic is the IMPORT graph between the modules themselves:
 *
 *   enums -> auth -> oauth -> org -> webhooks -> catalog -> inventory -> roasted
 *     -> materials -> sourcing -> production -> quality -> orders -> cafe
 *     -> traceability
 *
 * A module may only import from modules earlier in that chain.
 */
export * from "./auth";
export * from "./cafe";
export * from "./catalog";
export * from "./enums";
export * from "./inventory";
export * from "./materials";
export * from "./oauth";
export * from "./orders";
export * from "./org";
export * from "./production";
export * from "./quality";
export * from "./roasted";
export * from "./sourcing";
export * from "./traceability";
export * from "./webhooks";
