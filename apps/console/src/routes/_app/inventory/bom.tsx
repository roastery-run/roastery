import {
  Alert,
  AlertDescription,
  AlertTitle,
  ApiError,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  ErrorState,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  PageHeader,
  rpc,
  rpcMutate,
  Skeleton,
} from "@roastery/ui";
import { formatNumber, parseDecimal } from "@roastery/units";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Layers, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { z } from "zod";
import { SearchPicker } from "@/components/search-picker";
import { describeApiFailure, isNotFound, retryLabelFor } from "@/lib/api-failure";
import { useDebounced } from "@/lib/use-debounced";
import { useWorkspace } from "@/lib/workspace";

/**
 * The bill of materials editor.
 *
 * A BOM is only interesting for what it implies, so the requirements explosion
 * sits beside it: change a quantity, say how many units you plan to make, and
 * see immediately whether you have the packaging. Editing a recipe with no
 * sense of what it costs you in stock is how a roastery discovers on a Friday
 * that it has 400 bags and needs 900.
 */
export const Route = createFileRoute("/_app/inventory/bom")({
  validateSearch: z.object({ productId: z.string().optional().catch(undefined) }),
  component: BomEditor,
});

type Product = { id: string; sku: string; name: string; format: string };
type Material = { id: string; name: string; sku: string; currentQuantity: string };

type BomLine = {
  id: string;
  materialId: string;
  materialName: string;
  quantity: string;
  scrapPct: string;
  position: number;
};

type Bom = {
  id: string;
  productId: string;
  name: string;
  version: number;
  yieldQty: number;
  lines: BomLine[];
};

type Requirement = {
  materialId: string;
  materialName: string;
  requiredQty: string;
  onHandQty: string;
  shortfallQty: string;
  leadTimeDays: number | null;
};

type Draft = {
  key: string;
  materialId: string;
  quantity: string;
  scrapPct: string;
  /**
   * The material's name as the saved recipe reported it.
   *
   * `BomLine` already carries it, and carrying it forward is what lets a row
   * name its own material without a catalogue lookup — which was capped, so a
   * recipe referencing the two-hundred-and-first material rendered a row that
   * looked empty.
   */
  materialName?: string;
};

function BomEditor() {
  const { productId } = Route.useSearch();
  const { can } = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = React.useState("");
  const [yieldQty, setYieldQty] = React.useState("1");
  const [lines, setLines] = React.useState<Draft[]>([]);
  const [planned, setPlanned] = React.useState("1000");

  const products = useQuery({
    queryKey: ["catalog.product.listProducts", "bom"],
    queryFn: () =>
      rpc<{ items: Product[] }>("catalog.product.listProducts", { page: { limit: 200 } }),
  });

  const selected = productId ?? products.data?.items[0]?.id;

  const bom = useQuery({
    queryKey: ["inventory.material", "bom", selected],
    queryFn: () =>
      rpc<Bom | null>("inventory.material.getBillOfMaterials", { productId: selected }),
    enabled: Boolean(selected),
    retry: false,
  });

  // A product with no recipe yet is a 404, not an empty body — `loadBom` throws
  // NotFound rather than returning null. So the ordinary "write the first
  // recipe" state and a failed read arrive as the same rejected promise, and
  // telling them apart is the whole safety of this screen: one opens an empty
  // editor you may save, the other must never seed a draft at all.
  const missingRecipe = bom.isError && isNotFound(bom.error);
  const loadFailure = products.isError
    ? { error: products.error, what: "the product list", retry: () => void products.refetch() }
    : bom.isError && !missingRecipe
      ? { error: bom.error, what: "this bill of materials", retry: () => void bom.refetch() }
      : null;

  // The draft belongs to exactly one product, and it is seeded ONLY from a read
  // that resolved. Before, the effect below ran on `bom.data` — undefined on
  // failure — so a 500 emptied the editor, the screen said "No materials in
  // this bill yet", and the next save wrote that emptiness over a real recipe
  // as a new version. Seeding during render rather than in an effect also
  // avoids painting the previous product's rows for a frame under the new
  // product's name.
  const [draftFor, setDraftFor] = React.useState<string>();
  const readSettled = bom.isSuccess || missingRecipe;
  if (selected && readSettled && draftFor !== selected) {
    const loaded = bom.isSuccess ? bom.data : null;
    setDraftFor(selected);
    setName(loaded?.name ?? "");
    setYieldQty(String(loaded?.yieldQty ?? 1));
    setLines(
      (loaded?.lines ?? []).map((line) => ({
        key: line.id,
        materialId: line.materialId,
        materialName: line.materialName,
        quantity: line.quantity,
        scrapPct: line.scrapPct,
      })),
    );
  }

  // Nothing may be written from a draft that was never read into.
  const isDraftLoaded = draftFor === selected && loadFailure === null;

  // Compared against what was loaded rather than tracked with a flag, so
  // typing a character and deleting it does not count as an edit and the
  // guard below cannot get stuck on.
  const loaded = bom.isSuccess ? bom.data : null;
  const isDirty =
    isDraftLoaded &&
    (name !== (loaded?.name ?? "") ||
      yieldQty !== String(loaded?.yieldQty ?? 1) ||
      lines.length !== (loaded?.lines.length ?? 0) ||
      lines.some((line, index) => {
        const original = loaded?.lines[index];
        return (
          !original ||
          line.materialId !== original.materialId ||
          line.quantity !== original.quantity ||
          line.scrapPct !== original.scrapPct
        );
      }));

  // Debounced: the query key was the raw input, so typing "1000" fired four
  // explosions. ListPage debounces its search for the same reason and calls the
  // alternative a denial-of-service against your own API.
  const plannedQuery = useDebounced(planned, 300);

  const requirements = useQuery({
    queryKey: ["inventory.material", "requirements", selected, plannedQuery],
    queryFn: () =>
      rpc<{ runs: number; items: Requirement[] }>(
        "inventory.material.explodeMaterialRequirements",
        { productId: selected, quantity: Number(plannedQuery) || 1 },
      ),
    enabled: Boolean(selected) && Boolean(bom.data),
  });

  const save = useMutation({
    mutationFn: () =>
      rpcMutate<Bom>("inventory.material.setBillOfMaterials", {
        productId: selected,
        name: name.trim(),
        yieldQty: Number(yieldQty) || 1,
        lines: lines.map((line) => ({
          materialId: line.materialId,
          quantity: parseDecimal(line.quantity) ?? "0",
          scrapPct: parseDecimal(line.scrapPct) ?? "0",
        })),
      }),
    onSuccess: (result) => {
      // Versioned rather than overwritten, so a batch built last month still
      // reads against the recipe that built it.
      toast.success(`Saved as version ${result.version}`);
      void queryClient.invalidateQueries({ queryKey: ["inventory.material"] });
    },
    onError: (error) => {
      if (error instanceof ApiError && Object.keys(error.fields).length) {
        toast.error("Check the highlighted rows", {
          description: Object.values(error.fields)[0],
        });
        return;
      }
      toast.error(error instanceof Error ? error.message : "Could not save that bill");
    },
  });

  const selectedProduct = products.data?.items.find((product) => product.id === selected);
  const filled = lines.filter((line) => line.materialId && line.quantity.trim());
  const duplicated = new Set(filled.map((l) => l.materialId)).size !== filled.length;

  const blockedBecause = !isDraftLoaded
    ? "This recipe has not loaded, so there is nothing safe to save."
    : !name.trim()
      ? "The bill needs a name."
      : lines.length === 0
        ? "Add at least one material."
        : filled.length !== lines.length
          ? "Every row needs a material and a quantity."
          : duplicated
            ? "The same material appears in more than one row."
            : null;

  const shortfalls = (requirements.data?.items ?? []).filter(
    (item) => Number.parseFloat(item.shortfallQty) > 0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bills of materials"
        description="What a finished bag consumes, and whether you have enough of it."
        actions={
          <SearchPicker<Product>
            id="bom-product"
            label="Product this bill of materials is for"
            className="w-72"
            value={selected}
            operation="catalog.product.listProducts"
            toItem={(product) => ({ id: product.id, label: product.name, code: product.sku })}
            initialItem={
              selectedProduct
                ? { id: selectedProduct.id, label: selectedProduct.name, code: selectedProduct.sku }
                : undefined
            }
            placeholder="Choose a product"
            searchPlaceholder="Search products"
            emptyLabel="No product matches that."
            onSelect={(item) => {
              // Switching product reseeds the draft from the new product's
              // recipe, which silently threw away an edited one. The guard is
              // here rather than on save because this is the only place the
              // loss happens, and it happens without the person acting on the
              // recipe at all.
              if (
                isDirty &&
                !window.confirm(
                  "This bill has unsaved changes. Switching product will discard them.",
                )
              ) {
                return;
              }
              void navigate({ to: "/inventory/bom", search: { productId: item.id } });
            }}
          />
        }
      />

      {loadFailure ? (
        <ErrorState
          title={describeApiFailure(loadFailure.error).title}
          description={
            <>
              <p>{describeApiFailure(loadFailure.error).description}</p>
              <p className="mt-2">
                The editor stays closed until {loadFailure.what} loads. Saving from a recipe nobody
                could read is how a good bill gets replaced by an empty one.
              </p>
            </>
          }
          correlationId={describeApiFailure(loadFailure.error).correlationId}
          onRetry={loadFailure.retry}
          retryLabel={retryLabelFor(describeApiFailure(loadFailure.error).action)}
        />
      ) : products.data?.items.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No products yet"
          description="A bill of materials describes what one finished product consumes, so there has to be a product first."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Recipe
                  {bom.data ? (
                    <span className="ml-2 font-normal text-muted-foreground text-xs">
                      version {bom.data.version}
                    </span>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="bom-name">Name</FieldLabel>
                    <Input
                      id="bom-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="250 g retail bag"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="yield">Yield per run</FieldLabel>
                    <Input
                      id="yield"
                      aria-describedby="yield-description"
                      value={yieldQty}
                      onChange={(event) => setYieldQty(event.target.value)}
                      inputMode="numeric"
                      className="font-mono"
                    />
                    <FieldDescription id="yield-description" className="text-xs">
                      {/* A run that makes 12 bags consumes one carton, not
                          twelve — which is the whole reason yield exists. */}
                      How many finished units one run of this recipe makes.
                    </FieldDescription>
                  </Field>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm">Materials</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setLines((previous) => [
                      ...previous,
                      { key: crypto.randomUUID(), materialId: "", quantity: "", scrapPct: "0" },
                    ])
                  }
                  disabled={lines.length >= 100}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Add
                </Button>
              </CardHeader>
              <CardContent>
                {!isDraftLoaded ? (
                  <Skeleton className="h-24 w-full" />
                ) : lines.length === 0 ? (
                  <EmptyState
                    title="No materials in this bill yet"
                    description="Add the bag, the label, the valve — everything a finished unit consumes."
                    className="border-0"
                  />
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2 text-muted-foreground text-xs">
                      <span className="min-w-56 flex-1">Material</span>
                      <span className="w-28 text-right">Quantity</span>
                      <span className="w-24 text-right">Scrap %</span>
                      <span className="w-9" />
                    </div>
                    {lines.map((line, index) => (
                      <div key={line.key} className="flex flex-wrap items-center gap-2">
                        <div className="min-w-56 flex-1">
                          <SearchPicker<Material>
                            id={`bom-material-${line.key}`}
                            label={`Material for row ${index + 1}`}
                            value={line.materialId}
                            operation="inventory.material.listMaterials"
                            toItem={(material) => ({
                              id: material.id,
                              label: material.name,
                              code: material.sku,
                            })}
                            initialItem={
                              line.materialName
                                ? { id: line.materialId, label: line.materialName }
                                : undefined
                            }
                            placeholder="Choose a material"
                            searchPlaceholder="Search materials"
                            emptyLabel="No material matches that."
                            onSelect={(item) =>
                              setLines((previous) =>
                                previous.map((l) =>
                                  l.key === line.key
                                    ? { ...l, materialId: item.id, materialName: item.label }
                                    : l,
                                ),
                              )
                            }
                          />
                        </div>
                        <Input
                          value={line.quantity}
                          onChange={(event) =>
                            setLines((previous) =>
                              previous.map((l) =>
                                l.key === line.key ? { ...l, quantity: event.target.value } : l,
                              ),
                            )
                          }
                          placeholder="1"
                          inputMode="decimal"
                          className="w-28 text-right font-mono"
                          aria-label="Quantity"
                        />
                        <Input
                          value={line.scrapPct}
                          onChange={(event) =>
                            setLines((previous) =>
                              previous.map((l) =>
                                l.key === line.key ? { ...l, scrapPct: event.target.value } : l,
                              ),
                            )
                          }
                          inputMode="decimal"
                          className="w-24 text-right font-mono"
                          aria-label="Scrap percent"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setLines((previous) => previous.filter((l) => l.key !== line.key))
                          }
                          aria-label="Remove material"
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    ))}
                    <p className="pt-1 text-muted-foreground text-xs">
                      {/* Scrap is not padding: a label applicator wastes a
                          predictable share, and a requirement that ignores it
                          is short every single run. */}
                      Scrap is the share a run wastes. A requirement that ignores it comes up short
                      every time.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <Button
              size="lg"
              className="w-full"
              onClick={() => save.mutate()}
              disabled={
                save.isPending || blockedBecause !== null || !can("inventory.material.write")
              }
            >
              Save bill of materials
            </Button>
            {blockedBecause ? (
              <p className="text-center text-muted-foreground text-xs">{blockedBecause}</p>
            ) : null}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">What a run would need</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Field>
                  <FieldLabel htmlFor="planned">Finished units planned</FieldLabel>
                  <Input
                    id="planned"
                    value={planned}
                    onChange={(event) => setPlanned(event.target.value)}
                    inputMode="numeric"
                    className="font-mono"
                  />
                </Field>

                {requirements.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : !requirements.data ? (
                  <p className="text-muted-foreground text-sm">
                    Save the bill to see what it would consume.
                  </p>
                ) : (
                  <>
                    {shortfalls.length > 0 ? (
                      <Alert variant="destructive">
                        <AlertTriangle className="size-4" aria-hidden="true" />
                        <AlertTitle>
                          Short on {shortfalls.length} material
                          {shortfalls.length === 1 ? "" : "s"}
                        </AlertTitle>
                        <AlertDescription>
                          {/* Lead time is the actionable part: being 500 short
                              on something that takes six weeks is a different
                              problem from being short on something local. */}
                          {shortfalls
                            .map(
                              (item) =>
                                `${item.materialName}: ${formatNumber(item.shortfallQty, { digits: 0 })} short` +
                                (item.leadTimeDays ? ` (${item.leadTimeDays} day lead time)` : ""),
                            )
                            .join("; ")}
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {/* The pair is labelled above it, not explained below it.
                        "412 / 900" is only two numbers until something says
                        which is which. Outside the `dl`, because a row of bare
                        spans is not a valid child of one. */}
                    <div
                      aria-hidden="true"
                      className="flex items-center justify-between gap-2 pb-1.5 text-muted-foreground text-xs"
                    >
                      <span>Material</span>
                      <span className="shrink-0">Needs / on hand</span>
                    </div>
                    <dl className="divide-y divide-border text-sm">
                      {(requirements.data.items ?? []).map((item) => {
                        const short = Number.parseFloat(item.shortfallQty) > 0;
                        return (
                          <div
                            key={item.materialId}
                            className="flex items-center justify-between gap-2 py-1.5"
                          >
                            <dt className="min-w-0 truncate">
                              {short ? (
                                <>
                                  <span aria-hidden="true" className="mr-1 text-micro text-warning">
                                    ▲
                                  </span>
                                  <span className="sr-only">Short: </span>
                                </>
                              ) : null}
                              {item.materialName}
                            </dt>
                            <dd
                              className={cn(
                                "shrink-0 text-right font-mono text-xs tabular-nums",
                                short ? "text-warning" : "text-muted-foreground",
                              )}
                            >
                              {formatNumber(item.requiredQty, { digits: 0 })} /{" "}
                              {formatNumber(item.onHandQty, { digits: 0 })}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                    <p className="text-muted-foreground text-xs">
                      Across {requirements.data.runs} run
                      {requirements.data.runs === 1 ? "" : "s"}.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
