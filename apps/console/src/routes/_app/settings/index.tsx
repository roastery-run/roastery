import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Metric,
  PageHeader,
  useEntitlements,
} from "@roastery/ui";
import { humanize } from "@roastery/units";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Lock } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_app/settings/")({ component: OrganizationSettings });

function OrganizationSettings() {
  const { org, session } = useWorkspace();
  const entitlements = useEntitlements();

  const modules = Object.entries(entitlements?.modules ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const limits = Object.entries(entitlements?.limits ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization"
        description="Your plan, what it includes, and the limits it enforces."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="Organization"
          value={<span className="text-lg">{org?.orgName ?? "—"}</span>}
        />
        <Metric
          label="Plan"
          value={<span className="text-lg">{humanize(entitlements?.planSlug)}</span>}
        />
        <Metric label="Your role" value={<span className="text-lg">{org?.roleSlug ?? "—"}</span>} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Modules</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Locked modules are LISTED, not hidden. Someone deciding whether
                to upgrade needs to see what they would get, and support needs
                to be able to say "you should see nine rows here". */}
            <ul className="divide-y divide-border">
              {modules.map(([key, included]) => (
                <li key={key} className="flex items-center gap-2 py-2 text-sm">
                  {included ? (
                    <Check className="size-3.5 text-success" aria-hidden="true" />
                  ) : (
                    <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className={included ? "" : "text-muted-foreground"}>{humanize(key)}</span>
                  <span className="sr-only">
                    {included ? "included in your plan" : "not included in your plan"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Limits</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              {limits.map(([key, value]) => (
                <div key={key} className="flex justify-between gap-2 py-2 text-sm">
                  <dt>{humanize(key)}</dt>
                  <dd className="font-mono tabular-nums">
                    {/* Null means unlimited, and saying so plainly beats an
                        infinity symbol or a blank cell. */}
                    {value === null ? "Unlimited" : value}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Your memberships</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {(session?.memberships ?? []).map((membership) => (
              <li key={membership.orgId} className="flex items-center gap-2 py-2 text-sm">
                <span className="flex-1 truncate">{membership.orgName}</span>
                <Badge variant="secondary">{membership.roleSlug}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
