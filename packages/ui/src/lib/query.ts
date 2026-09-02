/**
 * Query keys and the shared client configuration.
 */
import { QueryClient } from "@tanstack/react-query";
import { ApiError, rpc } from "./api";

/**
 * Query keys mirror the RPC operation and its input.
 *
 * That correspondence is what makes invalidation obvious: after
 * `orders.confirmOrder`, invalidate `["orders.listOrders"]` and everything
 * that reads it updates. Hand-named keys drift from the operations they cache
 * and produce screens that show stale data after a successful write.
 */
export const queryKey = (operation: string, input?: unknown) =>
  input === undefined ? [operation] : [operation, input];

export function rpcQuery<T>(operation: string, input?: unknown) {
  return {
    queryKey: queryKey(operation, input),
    queryFn: ({ signal }: { signal: AbortSignal }) => rpc<T>(operation, input, { signal }),
  };
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        // The window regaining focus is not evidence the data changed, and on
        // a shop-floor tablet that switches apps all day it means a refetch
        // storm every time somebody picks it up.
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError) {
            // 4xx will not become a 2xx by asking again — except 429, which is
            // literally an instruction to wait and retry.
            if (error.status === 429) return failureCount < 3;
            if (error.status >= 400 && error.status < 500) return false;
          }
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: {
        // Never automatic. Every mutation carries an Idempotency-Key so a retry
        // is SAFE, but whether to retry is the user's call — silently re-sending
        // a failed "release schedule to production" is not our decision.
        retry: false,
      },
    },
  });
}
