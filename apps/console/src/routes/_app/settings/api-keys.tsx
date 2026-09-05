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
  EmptyState,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  StatusBadge,
} from "@roastery/ui";
import { formatDate, formatRelative } from "@roastery/units";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, KeyRound, Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_app/settings/api-keys")({ component: ApiKeys });

type ApiKey = {
  id: string;
  name: string;
  start: string | null;
  roleSlug: string;
  enabled: boolean;
  lastRequest: string | null;
  expiresAt: string | null;
  createdAt: string;
};

const ROLES = ["owner", "manager", "roaster", "qc", "viewer"] as const;

function ApiKeys() {
  const { can } = useWorkspace();
  const queryClient = useQueryClient();
  const [name, setName] = React.useState("");
  const [roleSlug, setRoleSlug] = React.useState<string>("viewer");
  const [issued, setIssued] = React.useState<string | null>(null);

  const keys = useQuery({
    queryKey: ["console.listApiKeys"],
    queryFn: () => rpc<{ items: ApiKey[] }>("console.listApiKeys", { page: { limit: 50 } }),
  });

  const create = useMutation({
    mutationFn: () =>
      rpcMutate<{ key: string }>("console.createApiKey", { name: name.trim(), roleSlug }),
    onSuccess: (result) => {
      setIssued(result.key);
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["console.listApiKeys"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not create that key"),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => rpcMutate("console.revokeApiKey", { id }),
    onSuccess: () => {
      toast.success("Key revoked");
      void queryClient.invalidateQueries({ queryKey: ["console.listApiKeys"] });
    },
  });

  const items = keys.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="API keys"
        description="Credentials for scripts and integrations you control."
      />

      {issued ? (
        <Alert>
          <KeyRound className="size-4" aria-hidden="true" />
          <AlertTitle>Copy this key now</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              {/* Stored hashed, so there is genuinely nothing to recover. */}
              It is stored hashed and cannot be shown again. A lost key is replaced, not retrieved.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg bg-muted px-2 py-1 font-mono text-xs">
                {issued}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(issued);
                  toast.success("Copied");
                }}
              >
                <Copy className="size-3.5" aria-hidden="true" />
                Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
                Done
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {can("console.credentials.write") ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Issue a key</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <Field className="min-w-56 flex-1">
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="What this key is for"
                  required
                />
              </Field>
              <Field className="w-auto">
                <FieldLabel htmlFor="role">Role</FieldLabel>
                <Select value={roleSlug} onValueChange={setRoleSlug}>
                  <SelectTrigger id="role" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button type="submit" disabled={create.isPending || !name.trim()}>
                {create.isPending ? <Spinner /> : <Plus className="size-3.5" aria-hidden="true" />}
                Issue
              </Button>
            </form>
            <p className="mt-2 text-muted-foreground text-xs">
              A key can never do more than its role. Give it the least that works.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Keys</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState icon={KeyRound} title="No API keys yet" className="border-0" />
          ) : (
            // A real <ul>/<li> rather than ItemGroup: that component marks
            // itself role="list" but Item never claims listitem, so the pair
            // announces as a list with nothing in it.
            <ul className="divide-y divide-border">
              {items.map((key) => (
                <Item key={key.id} asChild size="sm" className="px-0">
                  <li>
                    <ItemContent>
                      <ItemTitle className="truncate">{key.name}</ItemTitle>
                      <ItemDescription className="text-xs">
                        <span className="font-mono">{key.start ?? "sk_"}…</span> · {key.roleSlug} ·
                        created {formatDate(key.createdAt)}
                        {key.lastRequest
                          ? ` · last used ${formatRelative(key.lastRequest)}`
                          : " · never used"}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <StatusBadge status={key.enabled ? "active" : "disabled"} />
                      {can("console.credentials.write") && key.enabled ? (
                        <RevokeKeyButton
                          name={key.name}
                          pending={revoke.isPending}
                          onConfirm={() => revoke.mutate(key.id)}
                        />
                      ) : null}
                    </ItemActions>
                  </li>
                </Item>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Revocation asks first.
 *
 * The only irreversible action in the console: a revoked key cannot be
 * restored, and whatever was calling with it stops working at once. Disabling
 * a webhook, by contrast, has "Re-enable" sitting next to it and needs no
 * ceremony — a confirmation on everything trains people to dismiss them.
 */
function RevokeKeyButton({
  name,
  pending,
  onConfirm,
}: {
  name: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={pending}>
          Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Anything still calling the API with this key starts failing immediately. A revoked key
            cannot be restored — issue a new one and update the integration.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Revoke key
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
