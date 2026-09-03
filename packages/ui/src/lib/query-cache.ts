import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { QueryClient } from "@tanstack/react-query";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";

/**
 * Persisting the query cache across reloads.
 *
 * Without it, every hard refresh re-fetches everything the screen needs, and
 * on a deployment where each call is a few hundred milliseconds that is the
 * difference between a console that feels instant and one that feels broken.
 * The cache already survives navigation in memory; this is what makes it
 * survive a reload, a tab restore, and a shop-floor tablet waking up.
 */

const CACHE_KEY = "roastery.query-cache.v1";
const OWNER_KEY = "roastery.query-cache.owner";
/** Bump to invalidate every persisted cache after a breaking response change. */
const CACHE_BUSTER = "v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Never written to disk.
 *
 * Credentials and membership are the two things where a stale copy is worse
 * than a slow one: a revoked key or a removed member must not be served from
 * a browser's localStorage after the server has stopped honouring them.
 */
const SENSITIVE_KEY_PREFIXES = ["session", "console.getAccess", "console.credentials"];

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    // Private browsing, or storage disabled by policy. Persistence is an
    // optimisation; losing it must never stop the app from starting.
    return undefined;
  }
}

export function buildPersistOptions(): Omit<PersistQueryClientOptions, "queryClient"> {
  return {
    persister: createSyncStoragePersister({
      storage: storage() ?? null,
      key: CACHE_KEY,
      // Writing on every cache mutation would serialise the whole cache on
      // each keystroke-driven refetch.
      throttleTime: 1000,
    }),
    maxAge: MAX_AGE_MS,
    buster: CACHE_BUSTER,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) => {
        if (query.state.status !== "success") return false;
        const head = query.queryKey[0];
        return typeof head !== "string" || !SENSITIVE_KEY_PREFIXES.some((p) => head.startsWith(p));
      },
    },
  };
}

export function clearPersistedQueryCache(): void {
  const store = storage();
  store?.removeItem(CACHE_KEY);
  store?.removeItem(OWNER_KEY);
}

/**
 * Scopes the persisted cache to one user.
 *
 * Two people sharing a shop-floor terminal is normal, and without this the
 * second one would be served the first one's organisation from localStorage.
 */
export function ensureCacheOwner(userId: string, queryClient: QueryClient): void {
  const store = storage();
  if (!store) return;
  const previous = store.getItem(OWNER_KEY);
  if (previous !== null && previous !== userId) {
    store.removeItem(CACHE_KEY);
    queryClient.clear();
  }
  store.setItem(OWNER_KEY, userId);
}
