import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  PageHeader,
  rpc,
  rpcMutate,
  Spinner,
} from "@roastery/ui";
import { formatRelative } from "@roastery/units";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Download, FileDown } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_app/settings/data")({ component: DataSettings });

type DataExport = {
  id: string;
  status: "queued" | "ready" | "failed";
  error: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  createdAt: string;
  files: { table: string; rows: number; url: string }[];
};

/**
 * Taking the organization's data out, and closing the account.
 *
 * Both operations existed on the API before this screen did, and the privacy
 * policy told customers they could do them "from the console" — so until now
 * the policy described something they could not actually reach.
 *
 * Deliberately one screen. They are the two irreversible-feeling things an
 * owner does, and putting the export directly above the deletion is the point:
 * anybody about to delete an organization should see the way to keep a copy
 * first.
 */
function DataSettings() {
  const { can, org } = useWorkspace();
  const queryClient = useQueryClient();
  const [exportId, setExportId] = React.useState<string | null>(null);
  const [confirmSlug, setConfirmSlug] = React.useState("");

  const mayExport = can("console.data.export");
  const mayDelete = can("console.data.delete");

  const current = useQuery({
    queryKey: ["console.getDataExport", exportId],
    queryFn: () => rpc<DataExport>("console.getDataExport", { id: exportId }),
    enabled: Boolean(exportId),
    // An export runs in the background over every table, so the screen polls
    // while it is queued and stops the moment it is not.
    refetchInterval: (query) => (query.state.data?.status === "queued" ? 2000 : false),
  });

  const request = useMutation({
    mutationFn: () => rpcMutate<DataExport>("console.requestDataExport", {}),
    onSuccess: (result) => {
      setExportId(result.id);
      void queryClient.invalidateQueries({ queryKey: ["console.getDataExport"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not start that export"),
  });

  const remove = useMutation({
    mutationFn: () => rpcMutate("console.deleteOrganization", { confirmSlug: confirmSlug.trim() }),
    onSuccess: () => {
      // Every request from here on is refused, so there is no console left to
      // return to. A hard navigation, not a route change.
      window.location.assign("/login");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not delete this organization"),
  });

  const exported = current.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data"
        description="Export everything this organization holds, or close it down."
      />

      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            One file per table, as newline-delimited JSON, with a manifest listing every table and
            its row count. Credentials are excluded: the stored hashes are useless to you and would
            be a liability in a file you keep.
          </p>

          {!mayExport ? (
            <Alert>
              <AlertTitle>Owners only</AlertTitle>
              <AlertDescription>
                Exporting takes a copy of the whole organization, so it is restricted to owners.
              </AlertDescription>
            </Alert>
          ) : (
            <Button onClick={() => request.mutate()} disabled={request.isPending}>
              {request.isPending ? <Spinner className="size-4" /> : <FileDown className="size-4" />}
              Start an export
            </Button>
          )}

          {exported?.status === "queued" ? (
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner className="size-4" />
              Preparing your export. This runs in the background — you can leave this page.
            </p>
          ) : null}

          {exported?.status === "failed" ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertTitle>That export failed</AlertTitle>
              <AlertDescription>{exported.error ?? "No reason was recorded."}</AlertDescription>
            </Alert>
          ) : null}

          {exported?.status === "ready" ? (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                Ready
                {exported.expiresAt
                  ? `, and the links stop working ${formatRelative(exported.expiresAt)}.`
                  : "."}{" "}
                Download what you need now; starting another export is free.
              </p>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {exported.files.map((file) => (
                  <li key={file.table}>
                    <Item>
                      <ItemContent>
                        <ItemTitle>{file.table}</ItemTitle>
                        <ItemDescription>
                          {file.table === "manifest"
                            ? `${file.rows} tables`
                            : `${file.rows.toLocaleString()} rows`}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Button asChild size="sm" variant="outline">
                          <a href={file.url} download>
                            <Download className="size-3.5" aria-hidden="true" />
                            Download
                          </a>
                        </Button>
                      </ItemActions>
                    </Item>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {mayDelete ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Delete this organization</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Every request stops working immediately, and every API key and machine credential is
              revoked. The data itself is removed after seven days, during which support can undo
              this. After that it is gone, including roast curves and reports.
            </p>
            <p className="text-muted-foreground text-sm">
              Export first if you want a copy — afterwards there is nothing to export.
            </p>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Delete organization</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {org?.orgName}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This stops the organization working for everybody in it, straight away. Type its
                    slug to confirm.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Field>
                  <FieldLabel htmlFor="confirm-slug">
                    Type <code className="font-mono">{org?.orgSlug}</code>
                  </FieldLabel>
                  <Input
                    id="confirm-slug"
                    value={confirmSlug}
                    onChange={(event) => setConfirmSlug(event.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setConfirmSlug("")}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    // Typing the slug is the confirmation. A dialog on its own
                    // is something people click through.
                    disabled={confirmSlug.trim() !== org?.orgSlug || remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    Delete permanently
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
