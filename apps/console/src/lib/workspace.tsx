/**
 * The active workspace: organization, location and entitlements.
 *
 * The location is persisted, and it is VALIDATED against the active
 * organization on every org change. That is the classic bug in a
 * multi-tenant switcher: a location id left over from the previous org either
 * filters everything to nothing or, worse, is sent to an API that rejects it
 * with an error nobody can explain.
 */
import { ensureCacheOwner, getActiveOrg, rpc, setActiveOrg } from "@roastery/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { ORIGINS } from "@/lib/origins";

export type Membership = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  roleSlug: string;
};

export type Location = { id: string; name: string; code: string; kind: string };

export type Entitlements = {
  planSlug: string;
  modules: Record<string, boolean>;
  limits: Record<string, number | null>;
};

export type Me = {
  user: { id: string; name: string | null; email: string } | null;
  memberships: Membership[];
};

export type Access = {
  orgId: string;
  permissions: string[];
  entitlements: Entitlements;
};

export type Session = Me & {
  permissions: string[];
  entitlements: Entitlements | null;
};

type WorkspaceValue = {
  session: Session | null;
  isLoading: boolean;
  org: Membership | null;
  locations: Location[];
  locationId: string | null;
  setOrg: (orgId: string) => void;
  setLocation: (locationId: string | null) => void;
  can: (permission: string) => boolean;
  refresh: () => void;
};

const WorkspaceContext = React.createContext<WorkspaceValue | null>(null);

const ORG_KEY = "roastery.org";
const LOCATION_KEY = "roastery.location";

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    // A private window, or storage disabled. Not knowing the last org is a
    // minor inconvenience; throwing here would white-screen the whole app.
    return null;
  }
};

const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* as above */
  }
};

/**
 * Wildcard-aware permission check, matching the server's `can()` exactly.
 *
 * It must agree with the server or the UI shows an action that then 403s — and
 * the user has no way to tell whether they lack the permission or the product
 * is broken.
 */
function can(permissions: ReadonlySet<string>, permission: string): boolean {
  if (permissions.has("*") || permissions.has(permission)) return true;
  const parts = permission.split(".");
  for (let i = parts.length - 1; i > 0; i--) {
    if (permissions.has(`${parts.slice(0, i).join(".")}.*`)) return true;
  }
  return false;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [orgId, setOrgId] = React.useState<string | null>(() => read(ORG_KEY));
  const [locationId, setLocationId] = React.useState<string | null>(() => read(LOCATION_KEY));

  // Set during render, before any query runs, so the very first request
  // already carries the org header rather than reading another tenant's
  // default on mount.
  if (getActiveOrg() !== orgId) setActiveOrg(orgId);

  /**
   * Two calls, and the split is structural rather than an optimization.
   *
   * "Which organizations may I act in?" has no organization to scope to, so it
   * cannot be an RPC operation — every one of those requires an
   * `X-Roastery-Org` header. Once an org is chosen, everything else is
   * tenant-scoped, `console.getAccess` included.
   */
  const meQuery = useQuery({
    queryKey: ["session.me"],
    queryFn: async (): Promise<Me> => {
      const response = await fetch(`${ORIGINS.api}/session/v1/me`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Could not load your session");
      return response.json() as Promise<Me>;
    },
    retry: false,
    staleTime: 60_000,
  });

  const memberships = meQuery.data?.memberships ?? [];

  // Falls back to the first membership when the stored org is gone — a user
  // removed from an organization should land somewhere, not on an error.
  const org = React.useMemo(() => {
    const stored = memberships.find((m) => m.orgId === orgId);
    return stored ?? memberships[0] ?? null;
  }, [memberships, orgId]);

  React.useEffect(() => {
    if (org && org.orgId !== orgId) {
      setOrgId(org.orgId);
      write(ORG_KEY, org.orgId);
      setActiveOrg(org.orgId);
    }
  }, [org, orgId]);

  const accessQuery = useQuery({
    queryKey: ["console.getAccess", org?.orgId],
    queryFn: () => rpc<Access>("console.getAccess"),
    enabled: Boolean(org),
    staleTime: 60_000,
  });

  const session: Session | null = meQuery.data
    ? {
        ...meQuery.data,
        permissions: accessQuery.data?.permissions ?? [],
        entitlements: accessQuery.data?.entitlements ?? null,
      }
    : null;

  /**
   * The persisted query cache is scoped to one person.
   *
   * Two people sharing a shop-floor terminal is normal, and without this the
   * second one is served the first one's organisation straight out of
   * localStorage.
   */
  const userId = session?.user?.id;
  React.useEffect(() => {
    if (userId) ensureCacheOwner(userId, queryClient);
  }, [userId, queryClient]);

  const locationsQuery = useQuery({
    queryKey: ["catalog.location.listLocations", org?.orgId],
    queryFn: () =>
      rpc<{ items: Location[] }>("catalog.location.listLocations", { page: { limit: 200 } }),
    enabled: Boolean(org),
    staleTime: 5 * 60_000,
  });

  const locations = locationsQuery.data?.items ?? [];

  // THE bug this provider exists to prevent: a location id from the previous
  // organization surviving a switch.
  React.useEffect(() => {
    if (!locationsQuery.isSuccess) return;
    if (locationId && !locations.some((l) => l.id === locationId)) {
      setLocationId(null);
      write(LOCATION_KEY, null);
    }
  }, [locationsQuery.isSuccess, locations, locationId]);

  const permissions = React.useMemo(
    () => new Set(session?.permissions ?? []),
    [session?.permissions],
  );

  const value = React.useMemo<WorkspaceValue>(
    () => ({
      session,
      isLoading: meQuery.isLoading || accessQuery.isLoading,
      org,
      locations,
      locationId,
      setOrg: (next) => {
        setOrgId(next);
        write(ORG_KEY, next);
        setActiveOrg(next);
        // Cleared eagerly rather than waiting for the validation effect, so no
        // request is ever made with the previous org's location.
        setLocationId(null);
        write(LOCATION_KEY, null);
        queryClient.clear();
      },
      setLocation: (next) => {
        setLocationId(next);
        write(LOCATION_KEY, next);
      },
      can: (permission) => can(permissions, permission),
      refresh: () => queryClient.invalidateQueries(),
    }),
    [
      session,
      meQuery.isLoading,
      accessQuery.isLoading,
      org,
      locations,
      locationId,
      permissions,
      queryClient,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = React.useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside a WorkspaceProvider");
  return value;
}
