import { OpenAPIHono } from "@hono/zod-openapi";
import { machines } from "@roastery/db/schema";
import {
  getMachineInput,
  listMachinesInput,
  listMachinesOutput,
  machineSchema,
  registerMachineInput,
  updateMachineInput,
} from "@roastery/schemas";
import { and, eq, type SQL } from "drizzle-orm";
import { Conflict, NotFound } from "../../lib/api/errors";
import { type RpcAppEnv, registerRpc } from "../../lib/api/rpc";
import { requireQuota } from "../../lib/auth/entitlements";
import { isUniqueViolation } from "../../lib/db/db";

export const catalogMachine = new OpenAPIHono<RpcAppEnv>();

function toDto(r: typeof machines.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    locationId: r.locationId ?? null,
    brand: r.brand ?? null,
    model: r.model ?? null,
    machineType: r.machineType,
    capacityKg: r.capacityKg ?? null,
    minBatchKg: r.minBatchKg ?? null,
    maxBatchKg: r.maxBatchKg ?? null,
    connectivity: r.connectivity,
    // The device id is a credential-shaped identifier a bridge presents at
    // ingest, so it is never echoed back — only whether one is set.
    hasDeviceId: r.deviceId !== null,
    isActive: r.isActive,
    installedAt: r.installedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function patch(input: Record<string, unknown>): Record<string, unknown> {
  const numeric = new Set(["capacityKg", "minBatchKg", "maxBatchKg"]);
  const out: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(input)) {
    if (k === "id" || v === undefined) continue;
    if (k === "installedAt" && typeof v === "string") out[k] = new Date(v);
    else out[k] = typeof v === "number" && numeric.has(k) ? String(v) : v;
  }
  return out;
}

registerRpc(
  catalogMachine,
  {
    namespace: "catalog.machine",
    operation: "listMachines",
    summary: "List roasting machines",
    input: listMachinesInput,
    output: listMachinesOutput,
    permission: "catalog.machine.read",
    module: "core",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    if (input.filter?.locationId) clauses.push(eq(machines.locationId, input.filter.locationId));
    if (input.filter?.machineType) clauses.push(eq(machines.machineType, input.filter.machineType));
    if (input.filter?.isActive !== undefined) {
      clauses.push(eq(machines.isActive, input.filter.isActive));
    }
    const { items, page } = await ctx.db.find(machines, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(toDto), page };
  },
);

registerRpc(
  catalogMachine,
  {
    namespace: "catalog.machine",
    operation: "getMachine",
    summary: "Get one machine",
    input: getMachineInput,
    output: machineSchema,
    permission: "catalog.machine.read",
    module: "core",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const row = await ctx.db.findOne(machines, eq(machines.id, input.id));
    if (!row) throw new NotFound("Machine not found");
    return toDto(row);
  },
);

registerRpc(
  catalogMachine,
  {
    namespace: "catalog.machine",
    operation: "registerMachine",
    summary: "Register a roasting machine",
    description:
      "Machines are a metered resource: plans cap how many an organization may register, " +
      "so this can fail with 402 when the limit is reached.",
    input: registerMachineInput,
    output: machineSchema,
    permission: "catalog.machine.write",
    module: "core",
  },
  async (input, ctx) => {
    // Checked at the creating operation, which is the only place the count can
    // grow. A limit is a 402 (the plan is the obstacle), never a 403.
    await requireQuota(ctx, "machines", () => ctx.db.count(machines));

    try {
      const row = await ctx.db.transaction(async (tx) => {
        const [created] = await tx.insert(machines, {
          ...input,
          capacityKg: input.capacityKg?.toString(),
          minBatchKg: input.minBatchKg?.toString(),
          maxBatchKg: input.maxBatchKg?.toString(),
          installedAt: input.installedAt ? new Date(input.installedAt) : null,
        });
        if (!created) throw new Error("Insert returned no row");
        await tx.emit({
          type: "catalog.machine.registered",
          resourceType: "machine",
          resourceId: created.id,
          payload: { id: created.id, code: created.code, name: created.name },
        });
        return created;
      });
      return toDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new Conflict(`Machine code "${input.code}" already exists`);
      throw err;
    }
  },
);

registerRpc(
  catalogMachine,
  {
    namespace: "catalog.machine",
    operation: "updateMachine",
    summary: "Update a machine",
    input: updateMachineInput,
    output: machineSchema,
    permission: "catalog.machine.write",
    module: "core",
  },
  async (input, ctx) => {
    const [row] = await ctx.db.update(machines, patch(input), eq(machines.id, input.id));
    if (!row) throw new NotFound("Machine not found");
    return toDto(row);
  },
);
