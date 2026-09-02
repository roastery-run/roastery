import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  rpc,
  rpcMutate,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
              <code className="flex-1 overflow-x-auto rounded-sm bg-muted px-2 py-1 font-mono text-xs">
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
              <div className="min-w-56 flex-1 space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="What this key is for"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role">Role</Label>
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
              </div>
              <Button type="submit" disabled={create.isPending || !name.trim()}>
                <Plus className="size-3.5" aria-hidden="true" />
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
            <ul className="divide-y divide-border">
              {items.map((key) => (
                <li key={key.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-sm">{key.name}</div>
                    <div className="text-muted-foreground text-xs">
                      <span className="font-mono">{key.start ?? "sk_"}…</span> · {key.roleSlug} ·
                      created {formatDate(key.createdAt)}
                      {key.lastRequest
                        ? ` · last used ${formatRelative(key.lastRequest)}`
                        : " · never used"}
                    </div>
                  </div>
                  <StatusBadge status={key.enabled ? "active" : "disabled"} />
                  {can("console.credentials.write") && key.enabled ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => revoke.mutate(key.id)}
                      disabled={revoke.isPending}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
