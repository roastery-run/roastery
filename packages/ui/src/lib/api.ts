/**
 * The RPC client.
 *
 * Every surface — marketing, console, a customer's integration — calls the
 * same `/rpc/v1/{namespace}.{operation}`. That is the product argument, not
 * just an engineering one: if the console is just another client, a screen can
 * never do something the public API cannot.
 */

/**
 * A non-ok API response.
 *
 * Extends Error so `catch (e) { e.message }` keeps working, but it also keeps
 * the status and the PARSED BODY. The body is where the useful detail lives —
 * `fields` maps a validation failure back onto the form input that caused it,
 * and a 402 carries which module or limit blocked the call. Throwing that away
 * is why so many clients can only say "something went wrong".
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: ApiErrorBody;

  constructor(message: string, status: number, body: ApiErrorBody) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code;
    this.body = body;
  }

  /** Per-field messages, for `setError` on a form. */
  get fields(): Record<string, string> {
    return this.body?.fields ?? {};
  }

  /** A 402 is "your plan does not include this", never "you may not". */
  get isEntitlement(): boolean {
    return this.status === 402;
  }
}

export type ApiErrorBody = {
  error?: string;
  code?: string;
  fields?: Record<string, string>;
  module?: string;
  key?: string;
  limit?: number;
  current?: number;
  plan?: string;
} | null;

export type RpcOptions = {
  /** Retry-safe key. The first request to use it wins; later ones replay it. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Overrides the active organization for one call. */
  orgId?: string;
};

let apiBase = "";
let activeOrgId: string | null = null;

/** Set once at boot from the app's env. Empty means same-origin (dev proxy). */
export function configureApi(options: { baseUrl?: string }) {
  apiBase = (options.baseUrl ?? "").replace(/\/$/, "");
}

/**
 * The organization every subsequent call is made against.
 *
 * Held here rather than threaded through every call site because forgetting it
 * on one call would silently read another org's data — and because the server
 * treats a mismatched header as a 403 rather than a silent switch, a bug here
 * fails loudly instead of leaking.
 */
export function setActiveOrg(orgId: string | null) {
  activeOrgId = orgId;
}

export function getActiveOrg(): string | null {
  return activeOrgId;
}

export async function rpc<TOut = unknown, TIn = unknown>(
  operation: string,
  input?: TIn,
  options: RpcOptions = {},
): Promise<TOut> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const org = options.orgId ?? activeOrgId;
  if (org) headers["X-Roastery-Org"] = org;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`${apiBase}/rpc/v1/${operation}`, {
      method: "POST",
      // The session is a cookie; machine credentials never run in a browser.
      credentials: "include",
      headers,
      body: JSON.stringify(input ?? {}),
      signal: options.signal,
    });
  } catch (cause) {
    // A network failure is not an API error and must not be reported as one:
    // the retry policy and the message a user sees are both different.
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError("Could not reach the Roastery API", 0, {
      error: "network_error",
      code: "network_error",
    });
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody;
    throw new ApiError(body?.error ?? response.statusText, response.status, body);
  }

  if (response.status === 204) return undefined as TOut;
  return (await response.json()) as TOut;
}

/** A mutation whose retry is free. Generates the key so callers cannot forget. */
export async function rpcMutate<TOut = unknown, TIn = unknown>(
  operation: string,
  input?: TIn,
  options: RpcOptions = {},
): Promise<TOut> {
  return rpc<TOut, TIn>(operation, input, {
    ...options,
    idempotencyKey: options.idempotencyKey ?? crypto.randomUUID(),
  });
}
