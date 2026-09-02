/**
 * Every RPC operation, mounted in one place.
 *
 * The Worker entry imports this and nothing else from `rpc/`, so adding a
 * namespace is one import here rather than three edits in a 250-line file.
 *
 * LAYOUT RULE: one file per namespace, in a directory named for its domain. A
 * domain gets a directory once it has more than one namespace or a shared
 * helper module; a single-namespace domain stays a flat file, because
 * `webhooks/webhooks.ts` tells a reader nothing that `webhooks.ts` does not.
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { RpcAppEnv } from "../lib/api/rpc";
import { alerts } from "./alerts";
import { cafePos } from "./cafe/pos";
import { cafeShots } from "./cafe/shots";
import { cafeSitesRoutes } from "./cafe/sites";
import { catalogLocation } from "./catalog/location";
import { catalogMachine } from "./catalog/machine";
import { catalogParty } from "./catalog/party";
import { catalogProduct } from "./catalog/product";
import { consoleRoutes } from "./console";
import { inventoryCosting } from "./inventory/costing";
import { inventoryGreen } from "./inventory/green";
import { inventoryMaterial } from "./inventory/material";
import { inventoryRoast } from "./inventory/roasted";
import { orders } from "./orders/orders";
import { productionRoast } from "./production/roast";
import { productionSchedule } from "./production/schedule";
import { qualityCupping } from "./quality/cupping";
import { qualityForm } from "./quality/forms";
import { qualityGrading } from "./quality/grading";
import { reportingLabels } from "./reporting/labels";
import { reporting } from "./reporting/reports";
import { sourcingContract } from "./sourcing/contract";
import { sourcingSample } from "./sourcing/sample";
import { traceability } from "./traceability";
import { webhooks } from "./webhooks";

const MODULES = [
  alerts,
  cafePos,
  cafeShots,
  cafeSitesRoutes,
  catalogLocation,
  catalogMachine,
  catalogParty,
  catalogProduct,
  consoleRoutes,
  inventoryCosting,
  inventoryGreen,
  inventoryMaterial,
  inventoryRoast,
  orders,
  productionRoast,
  productionSchedule,
  qualityCupping,
  qualityForm,
  qualityGrading,
  reporting,
  reportingLabels,
  sourcingContract,
  sourcingSample,
  traceability,
  webhooks,
] as const;

export function mountRpcRoutes(app: OpenAPIHono<RpcAppEnv>): void {
  for (const module of MODULES) app.route("/", module);
}
