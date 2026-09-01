/**
 * EVERY pgEnum in the system lives here.
 *
 * Declaring the same enum name in two modules produces two objects and makes
 * drizzle-kit emit a duplicate `CREATE TYPE`. Centralizing them also removes
 * the most common source of circular imports between schema modules.
 */
import { pgEnum } from "drizzle-orm/pg-core";

/* ---------------------------------------------------------------- org */

export const locationKindEnum = pgEnum("location_kind", [
  "roastery",
  "warehouse",
  "cafe",
  "lab",
  "transit",
  "external",
]);

export const uomKindEnum = pgEnum("uom_kind", ["mass", "volume", "count", "bag", "length", "time"]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "paused",
]);

export const actorTypeEnum = pgEnum("actor_type", ["user", "api_key", "oauth_client", "system"]);
