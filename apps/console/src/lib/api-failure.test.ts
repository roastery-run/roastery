/**
 * The rule this file exists to hold: a retry is offered only where retrying
 * could work.
 *
 * The console's query client already refuses to retry a 4xx automatically. The
 * button is the same decision made a second time, by hand, thirty screens over
 * — and the failure mode of making it by hand is a "Try again" under a 403
 * that will never once succeed. Asserting the pairing here is what keeps the
 * two halves of that policy from drifting apart.
 */
import { ApiError } from "@roastery/ui/api";
import { describe, expect, it } from "vitest";
import {
  type ApiFailureAction,
  describeApiFailure,
  isNotFound,
  retryLabelFor,
} from "./api-failure";

const apiError = (status: number, body: Record<string, unknown> = {}) =>
  new ApiError("boom", status, { error: "boom", ...body });

describe("describeApiFailure", () => {
  it.each([
    [0, "retry"],
    [429, "retry"],
    [500, "retry"],
    [502, "retry"],
    [503, "retry"],
  ] as const)("offers a retry for %i, which can succeed on a second ask", (status, action) => {
    expect(describeApiFailure(apiError(status)).action).toBe<ApiFailureAction>(action);
  });

  it.each([401, 402, 403])("never offers a retry for %i", (status) => {
    expect(describeApiFailure(apiError(status)).action).not.toBe("retry");
  });

  it("reads a 404 as deploy skew rather than a missing record", () => {
    // Every list operation is registered at build time, so the only way one
    // 404s is a console asking an older API for something it does not have.
    const failure = describeApiFailure(apiError(404));
    expect(failure.action).toBe("reload");
    expect(failure.title).toMatch(/ahead of the API/i);
  });

  it("sends a bad filter back to the filters rather than to a retry", () => {
    expect(describeApiFailure(apiError(400)).action).toBe("clear-filters");
    expect(describeApiFailure(apiError(422)).action).toBe("clear-filters");
  });

  it("carries the correlation id through, because only a 500 has one", () => {
    expect(describeApiFailure(apiError(500, { correlationId: "8f2c1a" })).correlationId).toBe(
      "8f2c1a",
    );
    expect(describeApiFailure(apiError(403, { correlationId: "8f2c1a" })).correlationId).toBe(
      undefined,
    );
  });

  it("names the module a 402 blocked, humanized", () => {
    expect(describeApiFailure(apiError(402, { module: "sample_management" })).title).toBe(
      "Sample management is not on your plan",
    );
  });

  it("still says something specific when a 402 carries no module", () => {
    expect(describeApiFailure(apiError(402)).title).toBe("This module is not on your plan");
  });

  it("handles a thrown non-ApiError without claiming to know the status", () => {
    const failure = describeApiFailure(new TypeError("undefined is not a function"));
    expect(failure.action).toBe("retry");
    expect(failure.correlationId).toBeUndefined();
  });

  it("never returns an empty title or description", () => {
    const cases: unknown[] = [
      new TypeError("x"),
      ...[0, 400, 401, 402, 403, 404, 409, 422, 429, 500, 503].map((s) => apiError(s)),
    ];
    for (const error of cases) {
      const failure = describeApiFailure(error);
      expect(failure.title.length, `title for ${error}`).toBeGreaterThan(0);
      expect(failure.description.length, `description for ${error}`).toBeGreaterThan(0);
      // "Something went wrong" is the message that makes a person phone
      // somebody instead of fixing it.
      expect(failure.description).not.toMatch(/^Something went wrong\.?$/);
    }
  });
});

describe("isNotFound", () => {
  /**
   * `getBillOfMaterials` throws NotFound for a product that simply has no
   * recipe yet, which is every product before somebody writes one. The BOM
   * editor opens an empty, saveable form on that answer and refuses to open at
   * all on any other failure — so if this ever stopped distinguishing them, a
   * 500 would seed an empty draft and the next save would replace a real recipe
   * with nothing. That is the bug this guards.
   */
  it("is true only for a 404", () => {
    expect(isNotFound(apiError(404))).toBe(true);
    for (const status of [0, 400, 401, 402, 403, 409, 422, 429, 500, 503]) {
      expect(isNotFound(apiError(status)), `status ${status}`).toBe(false);
    }
  });

  it("is false for anything that is not an ApiError", () => {
    expect(isNotFound(new TypeError("boom"))).toBe(false);
    expect(isNotFound(null)).toBe(false);
    expect(isNotFound({ status: 404 })).toBe(false);
  });
});

describe("retryLabelFor", () => {
  it("names the consequence, never the gesture", () => {
    expect(retryLabelFor("retry")).toBe("Try again");
    expect(retryLabelFor("reload")).toBe("Reload the console");
    expect(retryLabelFor("clear-filters")).toBe("Clear filters");
  });

  it("gives no label where there is no action, so no button renders", () => {
    expect(retryLabelFor("none")).toBeUndefined();
  });

  it("has a label for every action that is not none", () => {
    const actions: ApiFailureAction[] = ["retry", "reload", "clear-filters", "none"];
    for (const action of actions) {
      const label = retryLabelFor(action);
      if (action === "none") expect(label).toBeUndefined();
      else expect(label, action).toBeTruthy();
    }
  });
});

describe("the subject", () => {
  /**
   * Six detail screens render this mapping. Before the subject was a
   * parameter they told somebody looking at one lot that "this list" could not
   * be loaded, on a screen with no list on it.
   */
  it("names what actually failed", () => {
    expect(describeApiFailure(apiError(500), "this lot").title).toBe(
      "The API could not load this lot",
    );
    expect(describeApiFailure(new TypeError("x"), "this blend").title).toBe(
      "This blend could not be loaded",
    );
  });

  it("defaults to a noun that is true on any surface", () => {
    expect(describeApiFailure(new TypeError("x")).title).toBe("This screen could not be loaded");
  });

  it("leaves the failures that name a cause rather than a subject alone", () => {
    // A 403 is about the reader, not about the thing being read, so the
    // subject does not belong in it.
    expect(describeApiFailure(apiError(403), "this lot").title).toBe(
      "You do not have permission to see this",
    );
  });
});
