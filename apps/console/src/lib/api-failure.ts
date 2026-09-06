/**
 * What a read screen says when the API refuses.
 *
 * Every list route and every detail screen shares one failure surface, so the
 * words are decided once here rather than thirty times in thirty components.
 * Pure on purpose: the mapping from a status code to a sentence and a recovery
 * is the part worth testing, and it needs neither React nor a network to test.
 *
 * Two rules the shape encodes:
 *
 * 1. A failure names its recovery. "Something went wrong" tells an operator
 *    standing at a roaster nothing they can act on, and it is what makes a
 *    person phone somebody instead of fixing it.
 * 2. Only a failure that could plausibly resolve offers a retry. A 403 will
 *    not become a 200 by asking again, and a button that reliably does nothing
 *    trains people to distrust the ones that work.
 */
import { ApiError } from "@roastery/ui/api";

/** What the screen offers the person, once it has said what happened. */
export type ApiFailureAction =
  /** Ask again. Only where asking again could work. */
  | "retry"
  /** The request was refused because of what is in the URL. */
  | "clear-filters"
  /** The console and the API disagree about what exists. */
  | "reload"
  /** Nothing the person can do from this screen. */
  | "none";

export type ApiFailure = {
  title: string;
  description: string;
  action: ApiFailureAction;
  /** Present on a 500 and nothing else. The id support searches the logs by. */
  correlationId?: string;
};

/**
 * @param subject What failed, in the sentence's own words. Defaults to the
 *   neutral noun because six detail screens render this and were being told
 *   their lot, blend or material was "a list".
 */
export function describeApiFailure(error: unknown, subject = "this screen"): ApiFailure {
  if (!(error instanceof ApiError)) {
    return {
      title: `${capitalize(subject)} could not be loaded`,
      description: "Something unexpected stopped it from loading. Try again.",
      action: "retry",
    };
  }

  // Status 0 is the client's own marker for "the request never left", which is
  // a different problem with a different fix from anything the API returned.
  if (error.status === 0) {
    return {
      title: "Cannot reach the ROASTERY API",
      description:
        "The request did not leave this device. Check the network connection, then try again.",
      action: "retry",
    };
  }

  if (error.status === 401) {
    return {
      title: "Your session has ended",
      description: "Sign in again to load this list. Nothing you have entered elsewhere is lost.",
      action: "none",
    };
  }

  if (error.isEntitlement) {
    const module = error.body?.module;
    return {
      title: module ? `${label(module)} is not on your plan` : "This module is not on your plan",
      description: "An owner can change the plan in Settings. The data behind it is untouched.",
      action: "none",
    };
  }

  if (error.status === 403) {
    return {
      title: "You do not have permission to see this",
      description:
        "Ask an owner or an admin to grant it on your role, then reload. Permissions are granted explicitly, so a new one never arrives on its own.",
      action: "none",
    };
  }

  // A 404 from an RPC operation is not a missing record: it is an operation the
  // API does not have. In practice that means this console is a deploy ahead.
  if (error.status === 404) {
    return {
      title: "This console is ahead of the API",
      description:
        "It asked for an operation this API version does not have. Reload to pick up the current console.",
      action: "reload",
    };
  }

  if (error.status === 429) {
    return {
      title: "Too many requests",
      description:
        "The API is rate limiting this organization. Wait a few seconds, then try again.",
      action: "retry",
    };
  }

  if (error.status >= 400 && error.status < 500) {
    return {
      title: "This filter could not be read",
      description:
        "One of the values in the address bar is not one the API accepts. Clearing the filters returns the full list.",
      action: "clear-filters",
    };
  }

  return {
    title: `The API could not load ${subject}`,
    description:
      "The failure is on our side, not in what you asked for. Try again; if it keeps failing, send support the reference below.",
    action: "retry",
    correlationId: error.correlationId,
  };
}

/**
 * The label for the recovery, naming what pressing it does.
 *
 * Lives beside the action rather than in each screen, because the whole point
 * of the action is that a person can tell "ask again" from "reload the app"
 * from "clear what you typed" before they press it.
 */
export function retryLabelFor(action: ApiFailureAction): string | undefined {
  return action === "retry"
    ? "Try again"
    : action === "reload"
      ? "Reload the console"
      : action === "clear-filters"
        ? "Clear filters"
        : undefined;
}

/**
 * Whether a failure is the API saying "there is no such thing".
 *
 * Some reads treat a 404 as an ANSWER rather than a failure:
 * `getBillOfMaterials` throws NotFound for a product that simply has no recipe
 * yet, which is the ordinary state of every product before somebody writes
 * one. Those call sites need to tell that apart from a read that failed,
 * because the two lead to opposite screens — an empty editor you may save, and
 * an error you must not save over.
 *
 * Kept separate from `describeApiFailure` deliberately: that function reads a
 * 404 as deploy skew, which is the right reading only where the operation is
 * supposed to always resolve.
 */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** `sample_management` reads as a slug; a person reads "Sample management". */
function label(slug: string): string {
  const spaced = slug.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
